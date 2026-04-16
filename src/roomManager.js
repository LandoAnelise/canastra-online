'use strict';

const { Game } = require('./GameEngine');

function createTrackedMap(onChange) {
  class TrackedMap extends Map {
    set(key, value) {
      super.set(key, value);
      onChange();
      return this;
    }

    delete(key) {
      const deleted = super.delete(key);
      if (deleted) onChange();
      return deleted;
    }

    clear() {
      if (this.size === 0) return;
      super.clear();
      onChange();
    }
  }
  return new TrackedMap();
}

function serializeGame(game) {
  return {
    ...game,
    botSeats: game.botSeats ? [...game.botSeats] : [],
  };
}

function hydrateGame(roomId, plain) {
  const game = new Game(roomId);
  Object.assign(game, plain);
  game.roomId = roomId;
  game.botSeats = new Set(Array.isArray(plain?.botSeats) ? plain.botSeats : []);
  game._createdAt = Number(game._createdAt) || Date.now();
  game._lastActivity = Number(game._lastActivity) || Date.now();

  if (!Array.isArray(game.players)) game.players = [];
  if (!Array.isArray(game.scores)) game.scores = [0, 0];
  if (!Array.isArray(game.teamNames)) game.teamNames = ['Dupla 1', 'Dupla 2'];
  if (!Array.isArray(game.teamOrders)) game.teamOrders = [[], []];
  if (!Array.isArray(game.playOrder)) game.playOrder = [0, 1, 2, 3];
  if (!Array.isArray(game.deck)) game.deck = [];
  if (!Array.isArray(game.discard)) game.discard = [];
  if (!Array.isArray(game.hands)) game.hands = [[], [], [], []];
  if (!Array.isArray(game.melds)) game.melds = [[], []];
  if (!Array.isArray(game.hasFirstMeld)) game.hasFirstMeld = [false, false];
  if (!Array.isArray(game.stagedMelds)) game.stagedMelds = [[], [], [], []];
  if (!Array.isArray(game.firstMeldPenalty)) game.firstMeldPenalty = [false, false];

  return game;
}

function createRoomManager(io) {
  let dirty = false;

  function markDirty() {
    dirty = true;
  }

  function clearDirty() {
    dirty = false;
  }

  function isDirty() {
    return dirty;
  }

  const rooms = createTrackedMap(markDirty); // roomId → Game
  const playerRoom = new Map(); // socketId → { roomId, seatIndex }

  // Reconnection registry: "ROOMID|normalizedName" → { seatIndex, disconnectTimer }
  const reconnectSlots = createTrackedMap(markDirty);

  const roomMeta = createTrackedMap(markDirty); // roomId → { isPublic }

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
      list.push({ roomId, playerCount: game.players.length, players: game.players.map((p) => p.name) });
    }
    return list.sort((a, b) => b.playerCount - a.playerCount);
  }

  function broadcastPublicRooms() {
    markDirty();
    io.emit('publicRoomsUpdated', { rooms: getPublicRoomsList() });
  }

  function broadcastState(game) {
    markDirty();
    game._lastActivity = Date.now();
    for (let i = 0; i < game.players.length; i++) {
      const p = game.players[i];
      if (p?.id) {
        const state = game.getStateFor(i);
        state.isLeader = i === (game.leaderSeatIndex ?? 0);
        io.to(p.id).emit('gameState', state);
      }
    }
  }

  function broadcastToRoom(roomId, event, data) {
    markDirty();
    const game = rooms.get(roomId);
    if (game) game._lastActivity = Date.now();
    io.to(roomId).emit(event, data);
  }

  // Pause/resume helpers
  function countDisconnectedPlayers(roomId) {
    let count = 0;
    for (const [key, slot] of reconnectSlots) {
      if (key.startsWith(roomId + '|') && slot.pausesGame) count++;
    }
    return count;
  }

  function pauseGame(game, roomId, playerName) {
    markDirty();
    game.paused = true;
    console.log(`[Room ${roomId}] ⏸  Jogo pausado — ${playerName} desconectou`);
    broadcastToRoom(roomId, 'gamePaused', { playerName, timeoutMs: RECONNECT_TIMEOUT_MS });
  }

  function resumeGame(game, roomId, playerName) {
    markDirty();
    const stillDisconnected = countDisconnectedPlayers(roomId);
    let unpaused = false;
    if (stillDisconnected > 0) {
      console.log(
        `[Room ${roomId}] ↩  ${playerName} reconectou, mas ${stillDisconnected} jogador(es) ainda desconectado(s)`,
      );
      broadcastToRoom(roomId, 'gameResumed', { playerName, stillPaused: true });
    } else {
      game.paused = false;
      unpaused = true;
      console.log(`[Room ${roomId}] ▶  Jogo retomado — ${playerName} reconectou`);
      broadcastToRoom(roomId, 'gameResumed', { playerName, stillPaused: false });
    }
    broadcastState(game);
    return { unpaused };
  }

  function broadcastRoundEnded(game, roomId, result) {
    markDirty();
    game.lastRoundResult = result;
    broadcastToRoom(roomId, 'roundEnded', result);
  }

  function exportState() {
    const serializedRooms = [];
    for (const [roomId, game] of rooms) {
      serializedRooms.push([roomId, serializeGame(game)]);
    }

    const serializedRoomMeta = [];
    for (const [roomId, meta] of roomMeta) {
      serializedRoomMeta.push([roomId, { isPublic: !!meta?.isPublic }]);
    }

    return {
      version: 1,
      savedAt: Date.now(),
      rooms: serializedRooms,
      roomMeta: serializedRoomMeta,
    };
  }

  function importState(state) {
    if (!state || typeof state !== 'object') return { restoredRooms: 0, restoredPublicRooms: 0 };

    rooms.clear();
    roomMeta.clear();
    reconnectSlots.clear();
    playerRoom.clear();

    const inputRooms = Array.isArray(state.rooms) ? state.rooms : [];
    for (const entry of inputRooms) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [roomId, plain] = entry;
      if (typeof roomId !== 'string' || !plain || typeof plain !== 'object') continue;
      const game = hydrateGame(roomId, plain);
      rooms.set(roomId, game);

      if (game.status === 'playing' || game.status === 'roundOver') {
        game.paused = true;
        for (let seatIndex = 0; seatIndex < game.players.length; seatIndex++) {
          const player = game.players[seatIndex];
          if (!player?.name) continue;
          if (game.botSeats?.has(seatIndex)) continue;
          reconnectSlots.set(reconnectKey(roomId, player.name), {
            seatIndex,
            disconnectTimer: null,
            pausesGame: true,
            playerName: player.name,
            disconnectedAt: Date.now(),
          });
        }
      }
    }

    const inputMeta = Array.isArray(state.roomMeta) ? state.roomMeta : [];
    for (const entry of inputMeta) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [roomId, meta] = entry;
      if (typeof roomId !== 'string') continue;
      roomMeta.set(roomId, { isPublic: !!meta?.isPublic });
    }

    clearDirty();

    const restoredPublicRooms = getPublicRoomsList().length;
    return { restoredRooms: rooms.size, restoredPublicRooms };
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
    broadcastRoundEnded,
    countDisconnectedPlayers,
    pauseGame,
    resumeGame,
    exportState,
    importState,
    markDirty,
    clearDirty,
    isDirty,
  };
}

module.exports = { createRoomManager };
