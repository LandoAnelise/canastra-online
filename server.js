'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Game } = require('./src/GameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── ROOM MANAGEMENT ─────────────────────────────────────────────────────────
const rooms      = new Map(); // roomId → Game
const playerRoom = new Map(); // socketId → { roomId, seatIndex }

// Reconnection registry: "ROOMID|normalizedName" → { seatIndex, disconnectTimer }
const reconnectSlots = new Map();

const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function reconnectKey(roomId, name) {
  return `${roomId}|${name.trim().toLowerCase()}`;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Game(roomId));
  return rooms.get(roomId);
}

function broadcastState(game) {
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (p?.id) io.to(p.id).emit('gameState', game.getStateFor(i));
  }
}

function broadcastToRoom(roomId, event, data) {
  io.to(roomId).emit(event, data);
}

// Pause/resume helpers
function pauseGame(game, roomId, playerName) {
  if (game.paused) return;
  game.paused = true;
  console.log(`[Room ${roomId}] ⏸  Jogo pausado — ${playerName} desconectou`);
  broadcastToRoom(roomId, 'gamePaused', { playerName, timeoutMs: RECONNECT_TIMEOUT_MS });
}

function resumeGame(game, roomId, playerName) {
  game.paused = false;
  console.log(`[Room ${roomId}] ▶  Jogo retomado — ${playerName} reconectou`);
  broadcastToRoom(roomId, 'gameResumed', { playerName });
  broadcastState(game);
}

// ─── SOCKET HANDLERS ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── JOIN / RECONNECT ──
  socket.on('joinRoom', ({ roomId, playerName }, cb) => {
    if (!roomId || !playerName) return cb({ ok: false, msg: 'Dados inválidos.' });

    const name = playerName.trim().slice(0, 20);
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
      const oldId = player.id;
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

    socket.join(roomId);
    playerRoom.set(socket.id, { roomId, seatIndex: result.seatIndex });
    console.log(`[Room ${roomId}] ${name} entrou (assento ${result.seatIndex})`);

    broadcastToRoom(roomId, 'playerJoined', {
      playerName: name,
      seatIndex: result.seatIndex,
      totalPlayers: game.players.length,
    });

    cb({ ok: true, seatIndex: result.seatIndex, roomId, reconnected: false });
    broadcastState(game);
  });

  // ── ASSIGN TEAMS ──
  socket.on('assignTeams', ({ teams }, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Você não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
    if (game.players.length < 4) return cb?.({ ok: false, msg: 'Aguardando todos os jogadores.' });

    const result = game.assignTeams(teams);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });

    game.readyPlayers = new Set();
    cb?.({ ok: true });
    broadcastState(game);
    broadcastToRoom(info.roomId, 'teamsAssigned', {
      players: game.players.map(p => ({ name: p.name, teamIndex: p.teamIndex })),
      readyPlayers: [],
    });
  });

  // ── PLAYER READY ──
  socket.on('playerReady', (_, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });

    if (!game.readyPlayers) game.readyPlayers = new Set();
    game.readyPlayers.add(info.seatIndex);

    broadcastToRoom(info.roomId, 'readyUpdate', {
      readyPlayers: [...game.readyPlayers],
      totalPlayers: game.players.length,
    });
    cb?.({ ok: true });

    if (game.readyPlayers.size === 4) {
      setTimeout(() => {
        game.startRound();
        broadcastState(game);
        broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
      }, 800);
    }
  });

  // ── GAME ACTIONS (guard: paused) ──
  function gameAction(handler) {
    return (data, cb) => {
      const info = playerRoom.get(socket.id);
      if (!info) return cb?.({ ok: false, msg: 'Você não está em uma sala.' });
      const game = rooms.get(info.roomId);
      if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
      if (game.paused) return cb?.({ ok: false, msg: 'Jogo pausado — aguardando jogador reconectar.' });
      handler(game, info, data, cb);
    };
  }

  socket.on('drawFromDeck', gameAction((game, info, _, cb) => {
    const result = game.drawFromDeck(info.seatIndex);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    broadcastState(game);
  }));

  socket.on('takeDiscard', gameAction((game, info, _, cb) => {
    const result = game.takeDiscard(info.seatIndex);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    broadcastState(game);
  }));

  socket.on('playMelds', gameAction((game, info, { meldActions }, cb) => {
    const result = game.playMelds(info.seatIndex, meldActions);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    broadcastState(game);
  }));

  socket.on('discard', gameAction((game, info, { cardId }, cb) => {
    const result = game.discard_(info.seatIndex, cardId);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    broadcastState(game);
  }));

  socket.on('bater', gameAction((game, info, { discardCardId = null } = {}, cb) => {
    const result = game.bater(info.seatIndex, discardCardId);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });

    broadcastState(game);
    broadcastToRoom(info.roomId, 'roundEnded', result);
    cb?.({ ok: true, result });

    // Next round only starts when someone clicks "Continuar"
  }));

  socket.on('continueRound', gameAction((game, info, _, cb) => {
    if (game.status !== 'roundOver') return cb?.({ ok: false, msg: 'Não há rodada aguardando.' });
    game.startRound();
    broadcastState(game);
    broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
    cb?.({ ok: true });
  }));

  socket.on('getDiscardPile', (_, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
    cb?.({ ok: true, cards: game.discard });
  });

  socket.on('newGame', (_, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Você não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
    if (game.status !== 'finished') return cb?.({ ok: false, msg: 'O jogo ainda não terminou.' });

    game.scores = [0, 0];
    game.round = 0;
    game.readyPlayers = new Set();
    game.startRound();
    broadcastState(game);
    broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
    cb?.({ ok: true });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const info = playerRoom.get(socket.id);
    if (info) {
      const game = rooms.get(info.roomId);
      if (game) {
        const player = game.players[info.seatIndex];
        const name   = player?.name || '?';
        console.log(`[-] ${name} desconectou da sala ${info.roomId}`);

        if (game.status === 'playing') {
          // Register reconnection slot with 5-min timer
          const key = reconnectKey(info.roomId, name);
          const timer = setTimeout(() => {
            // Time expired — remove slot and notify room
            reconnectSlots.delete(key);
            console.log(`[Room ${info.roomId}] ⏰ Tempo esgotado para ${name}`);
            broadcastToRoom(info.roomId, 'playerAbandoned', { playerName: name });
            // Optionally clean up the room if everyone left
            const allGone = game.players.every(p => !io.sockets.sockets.get(p.id));
            if (allGone) rooms.delete(info.roomId);
          }, RECONNECT_TIMEOUT_MS);

          reconnectSlots.set(key, { seatIndex: info.seatIndex, disconnectTimer: timer });

          // Pause the game and notify remaining players
          pauseGame(game, info.roomId, name);

          broadcastToRoom(info.roomId, 'playerDisconnected', {
            playerName: name,
            seatIndex: info.seatIndex,
            reconnectWindowMs: RECONNECT_TIMEOUT_MS,
          });
        } else {
          // Game not started yet — just notify
          broadcastToRoom(info.roomId, 'playerDisconnected', {
            playerName: name,
            seatIndex: info.seatIndex,
          });
        }
      }
    }
    playerRoom.delete(socket.id);
    console.log(`[-] Socket desconectado: ${socket.id}`);
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Canastra Online rodando em http://localhost:${PORT}\n`);
});
