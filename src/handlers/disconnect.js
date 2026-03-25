'use strict';

function registerDisconnectHandler(socket, io, rm) {
  const {
    rooms,
    playerRoom,
    reconnectSlots,
    reconnectKey,
    roomMeta,
    RECONNECT_TIMEOUT_MS,
    broadcastToRoom,
    broadcastPublicRooms,
    pauseGame,
  } = rm;

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
          // Game not started yet — free the slot immediately
          game.players.splice(info.seatIndex, 1);
          game.players.forEach((p, i) => {
            if (p) {
              p.seatIndex = i;
              const entry = playerRoom.get(p.id);
              if (entry) entry.seatIndex = i;
            }
          });
          game.leaderSeatIndex = 0;

          broadcastToRoom(info.roomId, 'playerDisconnected', {
            playerName: name,
            seatIndex: info.seatIndex,
          });

          if (game.players.length === 0) {
            rooms.delete(info.roomId);
            roomMeta.delete(info.roomId);
          } else {
            const { broadcastState } = rm;
            broadcastState(game);
          }
        }
      }
      const meta2 = roomMeta.get(info.roomId);
      if (meta2?.isPublic) broadcastPublicRooms();
    }
    playerRoom.delete(socket.id);
    console.log(`[-] Socket desconectado: ${socket.id}`);
  });
}

module.exports = { registerDisconnectHandler };
