'use strict';

function registerTeamHandlers(socket, io, rm) {
  const { rooms, playerRoom, broadcastState, broadcastToRoom } = rm;

  // ── ASSIGN TEAMS ──
  socket.on('assignTeams', ({ teams, teamOrders }, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Você não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
    if (game.players.length < 4) return cb?.({ ok: false, msg: 'Aguardando todos os jogadores.' });
    if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) {
      return cb?.({ ok: false, msg: 'Apenas o líder da sala pode definir as duplas.' });
    }

    const result = game.assignTeams(teams, teamOrders);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });

    game.readyPlayers = new Set();
    cb?.({ ok: true });
    broadcastState(game);
    broadcastToRoom(info.roomId, 'teamsAssigned', {
      players: game.players.map(p => ({ name: p.name, teamIndex: p.teamIndex })),
      readyPlayers: [],
    });
  });

  // ── TEAM DRAFT PREVIEW (leader broadcasts each drag to non-leaders) ──
  socket.on('teamDraftChanged', ({ assignments, teamOrders }) => {
    const info = playerRoom.get(socket.id);
    if (!info) return;
    const game = rooms.get(info.roomId);
    if (!game) return;
    if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) return; // only leader
    // Save draft on server so it's included in gameState for all players
    game.draft = { assignments, teamOrders };
    broadcastState(game);
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
      const { roomMeta, broadcastPublicRooms } = rm;
      const meta4 = roomMeta.get(info.roomId);
      if (meta4?.isPublic) broadcastPublicRooms();
      setTimeout(() => {
        game.startRound();
        broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
        broadcastState(game);
      }, 800);
    }
  });
}

module.exports = { registerTeamHandlers };
