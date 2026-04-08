'use strict';

const { runBotTurns } = require('../BotAI');

function remapBotSeats(botSeats, removedSeatIndex) {
  if (!botSeats || botSeats.size === 0) return new Set();
  const remapped = new Set();
  for (const seat of botSeats) {
    if (seat === removedSeatIndex) continue;
    remapped.add(seat > removedSeatIndex ? seat - 1 : seat);
  }
  return remapped;
}

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
    broadcastState,
  } = rm;

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const info = playerRoom.get(socket.id);
    if (info) {
      const game = rooms.get(info.roomId);
      if (game) {
        const player = game.players[info.seatIndex];
        const name = player?.name || '?';
        console.log(`[-] ${name} desconectou da sala ${info.roomId}`);

        if (game.status === 'playing' || game.status === 'roundOver') {
          // Registra slot de reconexão com timer de 5 min
          const key = reconnectKey(info.roomId, name);
          const timer = setTimeout(() => {
            reconnectSlots.delete(key);

            // Verifica se o jogo ainda existe
            if (!rooms.has(info.roomId)) return;

            // Garante que botSeats existe antes de qualquer verificação
            game.botSeats = game.botSeats || new Set();

            // Se não restam humanos, encerra o jogo
            const remainingHumans = game.players.filter(
              (p, i) => i !== info.seatIndex && p?.id && !game.botSeats.has(i),
            );
            if (remainingHumans.length === 0) {
              console.log(`[Room ${info.roomId}] Todos os jogadores saíram — encerrando sala`);
              broadcastToRoom(info.roomId, 'gameAbandoned', { playerName: name });
              rooms.delete(info.roomId);
              roomMeta.delete(info.roomId);
              return;
            }

            // ── Substitui por bot ──
            console.log(`[Room ${info.roomId}] 🤖 ${name} substituído por bot`);
            game.players[info.seatIndex].id = `bot_${info.seatIndex}_${Date.now()}`;
            game.botSeats.add(info.seatIndex);
            game.botDifficulty = game.botDifficulty || 'medium';
            game.paused = false;

            // Transfere liderança se o líder foi substituído
            if (game.leaderSeatIndex === info.seatIndex) {
              const nextHuman = game.players.findIndex(
                (p, i) => i !== info.seatIndex && p?.id && !game.botSeats.has(i),
              );
              if (nextHuman !== -1) game.leaderSeatIndex = nextHuman;
            }

            broadcastToRoom(info.roomId, 'gameResumed', { playerName: `${name} (Bot)` });
            broadcastState(game);

            // Se era a vez do bot, inicia os turnos
            if (game.status === 'playing' && game.currentPlayerIndex === info.seatIndex) {
              runBotTurns(game, info.roomId, rm, game.botDifficulty);
            }

            // Se a rodada estava esperando "Continuar" e o líder era o bot, auto-continua
            if (game.status === 'roundOver' && game.leaderSeatIndex === info.seatIndex) {
              setTimeout(() => {
                if (game.status !== 'roundOver') return;
                game.startRound();
                broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
                broadcastState(game);
                runBotTurns(game, info.roomId, rm, game.botDifficulty);
              }, 3000);
            }
          }, RECONNECT_TIMEOUT_MS);

          reconnectSlots.set(key, { seatIndex: info.seatIndex, disconnectTimer: timer });

          // Pausa o jogo e notifica os demais
          pauseGame(game, info.roomId, name);

          broadcastToRoom(info.roomId, 'playerDisconnected', {
            playerName: name,
            seatIndex: info.seatIndex,
            reconnectWindowMs: RECONNECT_TIMEOUT_MS,
          });
        } else {
          // Jogo ainda não começou — se o líder saiu, encerra a sala para todos
          if (info.seatIndex === game.leaderSeatIndex) {
            broadcastToRoom(info.roomId, 'roomClosed', { reason: 'O líder da sala saiu.' });
            rooms.delete(info.roomId);
            roomMeta.delete(info.roomId);
          } else {
            // Libera o slot e compacta
            game.players.splice(info.seatIndex, 1);
            game.players.forEach((p, i) => {
              if (p) {
                p.seatIndex = i;
                const entry = playerRoom.get(p.id);
                if (entry) entry.seatIndex = i;
              }
            });
            game.botSeats = remapBotSeats(game.botSeats, info.seatIndex);
            if (game.draft) game.draft = null;
            game.leaderSeatIndex = 0;

            broadcastToRoom(info.roomId, 'playerDisconnected', {
              playerName: name,
              seatIndex: info.seatIndex,
            });

            if (game.players.length === 0) {
              rooms.delete(info.roomId);
              roomMeta.delete(info.roomId);
            } else {
              broadcastState(game);
            }
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
