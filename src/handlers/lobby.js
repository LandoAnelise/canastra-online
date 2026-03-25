'use strict';

function registerLobbyHandlers(socket, rm) {
  const {
    rooms,
    playerRoom,
    roomMeta,
    getOrCreateRoom,
    generateRoomId,
    broadcastState,
    broadcastPublicRooms,
    reconnectKey,
    reconnectSlots,
    RECONNECT_TIMEOUT_MS,
    resumeGame,
  } = rm;

  // ── CREATE ROOM ──
  socket.on('createRoom', ({ playerName, isPublic = false }, cb) => {
    const name = playerName?.trim().slice(0, 10);
    if (!name) return cb?.({ ok: false, msg: 'Nome inválido.' });
    const roomId = generateRoomId();
    const game = getOrCreateRoom(roomId);
    roomMeta.set(roomId, { isPublic: !!isPublic });
    const result = game.addPlayer(socket.id, name);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    game.leaderSeatIndex = 0;
    socket.join(roomId);
    playerRoom.set(socket.id, { roomId, seatIndex: result.seatIndex });
    console.log(`[Room ${roomId}] Criada por ${name} (${isPublic ? 'pública' : 'privada'})`);
    cb?.({ ok: true, roomId, seatIndex: result.seatIndex });
    broadcastState(game);
    if (isPublic) broadcastPublicRooms();
  });

  socket.on('getPublicRooms', (_, cb) => {
    const { getPublicRoomsList } = rm;
    cb?.({ ok: true, rooms: getPublicRoomsList() });
  });

  // ── JOIN / RECONNECT ──
  socket.on('joinRoom', ({ roomId, playerName }, cb) => {
    if (!roomId || !playerName) return cb({ ok: false, msg: 'Dados inválidos.' });

    const name = playerName.trim().slice(0, 10);
    const game = getOrCreateRoom(roomId);
    const key  = reconnectKey(roomId, name);

    // ── RECONNECT path ──
    if (reconnectSlots.has(key)) {
      const slot = reconnectSlots.get(key);
      clearTimeout(slot.disconnectTimer);
      reconnectSlots.delete(key);

      const player = game.players[slot.seatIndex];
      if (!player) return cb({ ok: false, msg: 'Assento não encontrado.' });

      // Update socket id
      player.id = socket.id;
      socket.join(roomId);
      playerRoom.set(socket.id, { roomId, seatIndex: slot.seatIndex });

      console.log(`[Room ${roomId}] ↩  ${name} reconectou (assento ${slot.seatIndex})`);
      cb({ ok: true, seatIndex: slot.seatIndex, roomId, reconnected: true });

      if (game.status === 'playing' || game.status === 'finished') {
        resumeGame(game, roomId, name);
      } else {
        broadcastState(game);
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
    const meta = roomMeta.get(roomId);
    if (!meta) roomMeta.set(roomId, { isPublic: false }); // legacy join creates private room
    if (meta?.isPublic) broadcastPublicRooms();

    socket.join(roomId);
    playerRoom.set(socket.id, { roomId, seatIndex: result.seatIndex });
    console.log(`[Room ${roomId}] ${name} entrou (assento ${result.seatIndex})`);

    const { broadcastToRoom } = rm;
    broadcastToRoom(roomId, 'playerJoined', {
      playerName: name,
      seatIndex: result.seatIndex,
      totalPlayers: game.players.length,
    });

    cb({ ok: true, seatIndex: result.seatIndex, roomId, reconnected: false });
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

    // Remove player slot and compact the array
    game.players.splice(info.seatIndex, 1);
    // Fix seatIndex references for remaining players
    game.players.forEach((p, i) => { if (p) p.seatIndex = i; });
    // If leader left, keep seat 0 as leader
    game.leaderSeatIndex = 0;

    socket.leave(info.roomId);
    playerRoom.delete(socket.id);

    console.log(`[Room ${info.roomId}] ${name} saiu voluntariamente`);
    const { broadcastToRoom: btr } = rm;
    btr(info.roomId, 'playerDisconnected', { playerName: name, seatIndex: info.seatIndex });

    const meta = roomMeta.get(info.roomId);
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
