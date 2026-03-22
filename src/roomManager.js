'use strict';

const { Game } = require('./GameEngine');

function createRoomManager(io) {
  const rooms      = new Map(); // roomId → Game
  const playerRoom = new Map(); // socketId → { roomId, seatIndex }

  // Reconnection registry: "ROOMID|normalizedName" → { seatIndex, disconnectTimer }
  const reconnectSlots = new Map();

  const roomMeta = new Map(); // roomId → { isPublic }

  const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  function reconnectKey(roomId, name) {
    return `${roomId}|${name.trim().toLowerCase()}`;
  }

  function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Game(roomId));
    return rooms.get(roomId);
  }

  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function getPublicRoomsList() {
    const list = [];
    for (const [roomId, meta] of roomMeta) {
      if (!meta.isPublic) continue;
      const game = rooms.get(roomId);
      if (!game || game.status !== 'waiting' || game.players.length >= 4) continue;
      list.push({ roomId, playerCount: game.players.length, players: game.players.map(p => p.name) });
    }
    return list.sort((a, b) => b.playerCount - a.playerCount);
  }

  function broadcastPublicRooms() {
    io.emit('publicRoomsUpdated', { rooms: getPublicRoomsList() });
  }

  function broadcastState(game) {
    for (let i = 0; i < game.players.length; i++) {
      const p = game.players[i];
      if (p?.id) {
        const state = game.getStateFor(i);
        state.isLeader = (i === (game.leaderSeatIndex ?? 0));
        io.to(p.id).emit('gameState', state);
      }
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

  return {
    rooms,
    playerRoom,
    reconnectSlots,
    roomMeta,
    RECONNECT_TIMEOUT_MS,
    reconnectKey,
    getOrCreateRoom,
    generateRoomId,
    getPublicRoomsList,
    broadcastPublicRooms,
    broadcastState,
    broadcastToRoom,
    pauseGame,
    resumeGame,
  };
}

module.exports = { createRoomManager };
