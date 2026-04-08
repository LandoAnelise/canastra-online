'use strict';

const { runBotTurns } = require('../BotAI');
const { sanitizeName, isValidRoomId, isValidDifficulty } = require('../validation');

const DEV_MODE = process.env.DEV_MODE === 'true';

// ── Per-socket event rate limiting ──
function createRateLimiter(maxEvents, windowMs) {
  const counters = new Map(); // socketId → { count, resetAt }
  // Cleanup stale entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of counters) {
      if (now > entry.resetAt) counters.delete(id);
    }
  }, windowMs * 2);
  return {
    check(socketId) {
      const now = Date.now();
      let entry = counters.get(socketId);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        counters.set(socketId, entry);
      }
      entry.count++;
      return entry.count <= maxEvents;
    },
    remove(socketId) {
      counters.delete(socketId);
    },
  };
}

// Max 10 room-creation events per minute per socket
const createRoomLimiter = createRateLimiter(10, 60_000);
// Max 20 join attempts per minute per socket
const joinRoomLimiter = createRateLimiter(20, 60_000);

function remapBotSeats(botSeats, removedSeatIndex) {
  if (!botSeats || botSeats.size === 0) return new Set();
  const remapped = new Set();
  for (const seat of botSeats) {
    if (seat === removedSeatIndex) continue;
    remapped.add(seat > removedSeatIndex ? seat - 1 : seat);
  }
  return remapped;
}

function compactWaitingSeats(game, playerRoom, removedSeatIndex) {
  game.players.splice(removedSeatIndex, 1);
  game.players.forEach((p, i) => {
    if (!p) return;
    p.seatIndex = i;
    const entry = playerRoom.get(p.id);
    if (entry) entry.seatIndex = i;
  });

  game.botSeats = remapBotSeats(game.botSeats, removedSeatIndex);
  if (game.draft) game.draft = null;

  if (game.players.length === 0) {
    game.leaderSeatIndex = 0;
    return;
  }

  const leaderSeatIndex = game.leaderSeatIndex ?? 0;
  game.leaderSeatIndex = leaderSeatIndex > removedSeatIndex ? leaderSeatIndex - 1 : leaderSeatIndex;
}

function registerLobbyHandlers(socket, rm) {
  const {
    rooms,
    playerRoom,
    roomMeta,
    getOrCreateRoom,
    generateRoomId,
    broadcastState,
    broadcastRoundEnded,
    broadcastPublicRooms,
    reconnectKey,
    reconnectSlots,
    RECONNECT_TIMEOUT_MS,
    resumeGame,
  } = rm;

  // ── CREATE ROOM ──
  socket.on(
    'createRoom',
    ({ playerName, isPublic = false, testMode = false, testScores = [0, 0], botDifficulty = 'medium' }, cb) => {
      if (!createRoomLimiter.check(socket.id)) return cb?.({ ok: false, msg: 'Muitas requisições. Aguarde.' });
      const name = sanitizeName(playerName);
      if (!name) return cb?.({ ok: false, msg: 'Nome inválido.' });
      if (testMode && !DEV_MODE) return cb?.({ ok: false, msg: 'Sala de teste indisponível.' });
      const validDifficulty = isValidDifficulty(botDifficulty) ? botDifficulty : 'medium';
      const roomId = generateRoomId();
      const game = getOrCreateRoom(roomId);
      roomMeta.set(roomId, { isPublic: !testMode && !!isPublic });
      const result = game.addPlayer(socket.id, name);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      game.leaderSeatIndex = 0;
      socket.join(roomId);
      playerRoom.set(socket.id, { roomId, seatIndex: result.seatIndex });

      if (testMode) {
        // Adiciona 3 bots e configura a sala automaticamente
        for (let i = 1; i <= 3; i++) game.addPlayer(`bot-${i}-${roomId}`, `Bot ${i}`);
        game.botSeats = new Set([1, 2, 3]);
        game.testMode = true;
        game.botDifficulty = validDifficulty;
        game.assignTeams(
          [
            { seatIndex: 0, teamIndex: 0 },
            { seatIndex: 1, teamIndex: 1 },
            { seatIndex: 2, teamIndex: 0 },
            { seatIndex: 3, teamIndex: 1 },
          ],
          { 0: [0, 2], 1: [1, 3] },
        );
        game.setTestScores(testScores[0], testScores[1]);
        game.startRound();
        console.log(
          `[Room ${roomId}] Sala de teste criada por ${name} (scores: ${game.scores}, dificuldade: ${game.botDifficulty})`,
        );
        cb?.({ ok: true, roomId, seatIndex: 0, testMode: true });
        broadcastState(game);
        // Inicia turnos dos bots se o primeiro jogador for bot
        runBotTurns(game, roomId, rm, game.botDifficulty);
        return;
      }

      console.log(`[Room ${roomId}] Criada por ${name} (${isPublic ? 'pública' : 'privada'})`);
      cb?.({ ok: true, roomId, seatIndex: result.seatIndex });
      broadcastState(game);
      if (isPublic) broadcastPublicRooms();
    },
  );

  socket.on('getPublicRooms', (_, cb) => {
    const { getPublicRoomsList } = rm;
    cb?.({ ok: true, rooms: getPublicRoomsList() });
  });

  // ── JOIN / RECONNECT ──
  socket.on('joinRoom', ({ roomId, playerName }, cb) => {
    if (!joinRoomLimiter.check(socket.id)) return cb?.({ ok: false, msg: 'Muitas requisições. Aguarde.' });
    if (!roomId || !playerName) return cb({ ok: false, msg: 'Dados inválidos.' });

    const name = sanitizeName(playerName);
    if (!name) return cb({ ok: false, msg: 'Nome inválido.' });

    // Validate room ID format
    const cleanRoomId = typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
    if (!isValidRoomId(cleanRoomId)) return cb({ ok: false, msg: 'Código de sala inválido.' });

    const key = reconnectKey(cleanRoomId, name);

    // Sala deve existir — não criar automaticamente
    if (!rooms.has(cleanRoomId) && !reconnectSlots.has(key)) {
      return cb({ ok: false, msg: 'Sala não encontrada.' });
    }

    const game = rooms.get(cleanRoomId) || getOrCreateRoom(cleanRoomId);

    // ── RECONNECT path ──
    if (reconnectSlots.has(key)) {
      const slot = reconnectSlots.get(key);
      clearTimeout(slot.disconnectTimer);
      reconnectSlots.delete(key);

      const player = game.players[slot.seatIndex];
      if (!player) return cb({ ok: false, msg: 'Assento não encontrado.' });

      // Update socket id
      player.id = socket.id;
      socket.join(cleanRoomId);
      playerRoom.set(socket.id, { roomId: cleanRoomId, seatIndex: slot.seatIndex });

      console.log(`[Room ${cleanRoomId}] ↩  ${name} reconectou (assento ${slot.seatIndex})`);
      cb({ ok: true, seatIndex: slot.seatIndex, roomId: cleanRoomId, reconnected: true });

      if (game.status === 'finished') {
        // Jogo encerrado: envia estado e modal apenas para quem reconectou, sem avisar os demais
        const gs = game.getStateFor(slot.seatIndex);
        gs.isLeader = slot.seatIndex === (game.leaderSeatIndex ?? 0);
        socket.emit('gameState', gs);
        if (game.lastRoundResult) socket.emit('roundEnded', { ...game.lastRoundResult, isResync: true });
      } else {
        resumeGame(game, cleanRoomId, name);
        if (game.status === 'roundOver' && game.lastRoundResult) {
          socket.emit('roundEnded', { ...game.lastRoundResult, isResync: true });
        }
        // Se o jogo ainda está pausado (outros jogadores desconectados), reenvia os timers
        // de pausa para o jogador que acabou de reconectar
        if (game.paused) {
          for (const [slotKey, slotData] of reconnectSlots) {
            if (slotKey.startsWith(cleanRoomId + '|') && slotData.pausesGame) {
              const remaining = RECONNECT_TIMEOUT_MS - (Date.now() - (slotData.disconnectedAt || 0));
              socket.emit('gamePaused', {
                playerName: slotData.playerName || slotKey.split('|')[1],
                timeoutMs: Math.max(0, remaining),
                isResync: true,
              });
            }
          }
        }
      }
      return;
    }

    // ── NEW PLAYER path ──
    // Block joining a game already in progress (unless reconnecting)
    if (game.status === 'playing' || game.status === 'finished') {
      return cb({ ok: false, msg: 'O jogo já está em andamento nessa sala.' });
    }

    const result = game.addPlayer(socket.id, name);
    if (!result.ok) return cb({ ok: false, msg: result.msg });

    if (game.players.length === 1) game.leaderSeatIndex = 0;
    const meta = roomMeta.get(cleanRoomId);
    if (!meta) roomMeta.set(cleanRoomId, { isPublic: false }); // legacy join creates private room
    if (meta?.isPublic) broadcastPublicRooms();

    socket.join(cleanRoomId);
    playerRoom.set(socket.id, { roomId: cleanRoomId, seatIndex: result.seatIndex });
    console.log(`[Room ${cleanRoomId}] ${name} entrou (assento ${result.seatIndex})`);

    const { broadcastToRoom } = rm;
    broadcastToRoom(cleanRoomId, 'playerJoined', {
      playerName: name,
      seatIndex: result.seatIndex,
      totalPlayers: game.players.length,
    });

    cb({ ok: true, seatIndex: result.seatIndex, roomId: cleanRoomId, reconnected: false });
    broadcastState(game);
  });

  // ── ADD BOT TO ROOM (pre-game, leader only) ──
  socket.on('addBotToRoom', ({ difficulty = 'medium' } = {}, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game || game.status !== 'waiting') return cb?.({ ok: false, msg: 'Sala não disponível.' });
    if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) {
      return cb?.({ ok: false, msg: 'Apenas o líder pode adicionar bots.' });
    }
    if (game.players.length >= 4) return cb?.({ ok: false, msg: 'Sala cheia.' });

    game.botSeats = game.botSeats || new Set();
    const botNum = game.botSeats.size + 1;
    const botName = `Bot ${botNum}`;
    const botId = `bot-${info.roomId}-${Date.now()}`;
    game.botDifficulty = isValidDifficulty(difficulty) ? difficulty : 'medium';

    const result = game.addPlayer(botId, botName);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });

    game.botSeats.add(result.seatIndex);

    console.log(
      `[Room ${info.roomId}] 🤖 ${botName} adicionado (assento ${result.seatIndex}, dificuldade: ${game.botDifficulty})`,
    );

    const { broadcastToRoom: btr } = rm;
    btr(info.roomId, 'playerJoined', {
      playerName: botName,
      seatIndex: result.seatIndex,
      totalPlayers: game.players.length,
      isBot: true,
    });

    cb?.({ ok: true, seatIndex: result.seatIndex, botName });
    broadcastState(game);
  });

  // ── KICK BOT FROM ROOM (pre-game, leader only) ──
  socket.on('kickBotFromRoom', (payload = {}, cb) => {
    const seatIndex = Number(payload.seatIndex);
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game || game.status !== 'waiting') return cb?.({ ok: false, msg: 'Sala não disponível.' });
    if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) {
      return cb?.({ ok: false, msg: 'Apenas o líder pode remover bots.' });
    }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= game.players.length) {
      return cb?.({ ok: false, msg: 'Assento inválido.' });
    }

    game.botSeats = game.botSeats || new Set();
    if (!game.botSeats.has(seatIndex)) {
      return cb?.({ ok: false, msg: 'Esse assento não é de bot.' });
    }

    const botName = game.players[seatIndex]?.name || 'Bot';
    compactWaitingSeats(game, playerRoom, seatIndex);

    const { broadcastToRoom: btr } = rm;
    btr(info.roomId, 'playerDisconnected', { playerName: botName, seatIndex, isBot: true });

    cb?.({ ok: true, botName });
    broadcastState(game);
  });

  // ── LEAVE ROOM (voluntary, pre-game only) ──
  socket.on('leaveRoom', () => {
    const info = playerRoom.get(socket.id);
    if (!info) return;
    const game = rooms.get(info.roomId);
    if (!game || game.status !== 'waiting') return;

    const player = game.players[info.seatIndex];
    const name = player?.name || '?';
    const meta = roomMeta.get(info.roomId);
    const { broadcastToRoom: btr } = rm;

    socket.leave(info.roomId);
    playerRoom.delete(socket.id);

    // Se o líder saiu, encerra a sala para todos
    if (info.seatIndex === game.leaderSeatIndex) {
      console.log(`[Room ${info.roomId}] Líder ${name} saiu — sala encerrada`);
      btr(info.roomId, 'roomClosed', { reason: 'O líder da sala saiu.' });
      rooms.delete(info.roomId);
      roomMeta.delete(info.roomId);
      if (meta?.isPublic) broadcastPublicRooms();
      return;
    }

    // Remove slot e compacta
    compactWaitingSeats(game, playerRoom, info.seatIndex);
    game.leaderSeatIndex = 0;

    console.log(`[Room ${info.roomId}] ${name} saiu voluntariamente`);
    btr(info.roomId, 'playerDisconnected', { playerName: name, seatIndex: info.seatIndex });

    if (game.players.length === 0) {
      rooms.delete(info.roomId);
      roomMeta.delete(info.roomId);
    } else {
      broadcastState(game);
    }

    if (meta?.isPublic) broadcastPublicRooms();
  });
}

module.exports = { registerLobbyHandlers };
