'use strict';

const { runBotTurns } = require('../BotAI');
const { isValidCardId } = require('../validation');

function registerGameHandlers(socket, io, rm) {
  const { rooms, playerRoom, broadcastState, broadcastToRoom } = rm;

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

  socket.on(
    'drawFromDeck',
    gameAction((game, info, _, cb) => {
      const result = game.drawFromDeck(info.seatIndex);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true });
      socket.to(info.roomId).emit('playerDrew', {});
      broadcastState(game);
      if (result.deckNowEmpty) {
        broadcastToRoom(info.roomId, 'deckEmpty', { playerName: game.players[info.seatIndex]?.name });
      }
    }),
  );

  socket.on(
    'takeDiscard',
    gameAction((game, info, _, cb) => {
      const result = game.takeDiscard(info.seatIndex);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true });
      socket.to(info.roomId).emit('playerTookDiscard', {});
      broadcastState(game);
    }),
  );

  socket.on(
    'playMelds',
    gameAction((game, info, { meldActions }, cb) => {
      if (!Array.isArray(meldActions) || meldActions.length === 0) return cb?.({ ok: false, msg: 'Ações inválidas.' });
      // Validate card IDs in all actions
      for (const action of meldActions) {
        if (!Array.isArray(action.cards)) return cb?.({ ok: false, msg: 'Cartas inválidas.' });
        if (action.cards.some((id) => !isValidCardId(id))) return cb?.({ ok: false, msg: 'ID de carta inválido.' });
      }
      const result = game.playMelds(info.seatIndex, meldActions);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true, meldTypes: result.meldTypes });
      socket.to(info.roomId).emit('playerDealt', {});
      if (result.autoBater) broadcastToRoom(info.roomId, 'roundEnded', result);
      broadcastState(game);
    }),
  );

  socket.on(
    'stageMeld',
    gameAction((game, info, { cardIds }, cb) => {
      if (!Array.isArray(cardIds) || cardIds.some((id) => !isValidCardId(id))) return cb?.({ ok: false, msg: 'IDs de carta inválidos.' });
      const result = game.stageMeld(info.seatIndex, cardIds);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true });
      socket.to(info.roomId).emit('playerDealt', {});
      broadcastState(game);
    }),
  );

  socket.on(
    'addToStagedMeld',
    gameAction((game, info, { stagedMeldIdx, cardIds }, cb) => {
      if (!Number.isInteger(stagedMeldIdx) || stagedMeldIdx < 0) return cb?.({ ok: false, msg: 'Índice inválido.' });
      if (!Array.isArray(cardIds) || cardIds.some((id) => !isValidCardId(id))) return cb?.({ ok: false, msg: 'IDs de carta inválidos.' });
      const result = game.addToStagedMeld(info.seatIndex, stagedMeldIdx, cardIds);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true });
      broadcastState(game);
    }),
  );

  socket.on(
    'confirmStagedMelds',
    gameAction((game, info, _, cb) => {
      const result = game.confirmStagedMelds(info.seatIndex);
      if (!result.ok) {
        if (result.penalized) {
          const p = game.players[info.seatIndex];
          broadcastToRoom(info.roomId, 'stagingPenalty', {
            playerName: p.name,
            teamName: game.teamNames[p.teamIndex],
          });
        }
        cb?.({ ok: false, msg: result.msg, penalized: result.penalized });
        broadcastState(game);
        return;
      }
      if (result.autoBater || result.deckEndRound) {
        broadcastToRoom(info.roomId, 'roundEnded', result);
      } else {
        socket.to(info.roomId).emit('playerDealt', {});
      }
      broadcastState(game);
      cb?.({ ok: true, meldTypes: result.meldTypes });
    }),
  );

  socket.on(
    'discard',
    gameAction((game, info, { cardId }, cb) => {
      if (!isValidCardId(cardId)) return cb?.({ ok: false, msg: 'ID de carta inválido.' });
      const result = game.discard_(info.seatIndex, cardId);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });
      cb?.({ ok: true });
      if (result.autoBater || result.deckEndRound) {
        broadcastToRoom(info.roomId, 'roundEnded', result);
      } else {
        runBotTurns(game, info.roomId, rm);
      }
      broadcastState(game);
    }),
  );

  socket.on(
    'bater',
    gameAction((game, info, { discardCardId = null } = {}, cb) => {
      if (discardCardId !== null && !isValidCardId(discardCardId)) return cb?.({ ok: false, msg: 'ID de carta inválido.' });
      const result = game.bater(info.seatIndex, discardCardId);
      if (!result.ok) return cb?.({ ok: false, msg: result.msg });

      broadcastToRoom(info.roomId, 'roundEnded', result);
      broadcastState(game);
      cb?.({ ok: true, result });

      // Next round only starts when someone clicks "Continuar"
    }),
  );

  socket.on(
    'continueRound',
    gameAction((game, info, _, cb) => {
      if (game.status !== 'roundOver') return cb?.({ ok: false, msg: 'Não há rodada aguardando.' });
      if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) return cb?.({ ok: false, msg: 'Apenas o líder da sala pode iniciar a próxima rodada.' });
      game.startRound();
      broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
      broadcastState(game);
      cb?.({ ok: true });
      runBotTurns(game, info.roomId, rm);
    }),
  );

  // ── DEV: ajustar pontos em sala de teste ──
  socket.on('setTestScores', (data, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game?.testMode) return cb?.({ ok: false, msg: 'Apenas em sala de teste.' });
    if (typeof data?.s0 !== 'number' || typeof data?.s1 !== 'number') return cb?.({ ok: false, msg: 'Dados inválidos.' });
    game.setTestScores(data.s0, data.s1);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('getDiscardPile', (_, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game) return cb?.({ ok: false, msg: 'Sala não encontrada.' });
    cb?.({ ok: true, cards: game.discard });
  });

  socket.on('leaveGame', (_, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: true });
    const game = rooms.get(info.roomId);
    const { roomMeta, broadcastPublicRooms } = rm;
    const playerName = game?.players[info.seatIndex]?.name || 'Jogador';

    // Remove o socket da sala e do mapa imediatamente
    socket.leave(info.roomId);
    playerRoom.delete(socket.id);
    cb?.({ ok: true });

    if (!game) return;

    // Se o jogo ainda não começou (não deveria chegar aqui, mas por segurança)
    if (game.status !== 'playing' && game.status !== 'roundOver') {
      rooms.delete(info.roomId);
      roomMeta.delete(info.roomId);
      socket.to(info.roomId).emit('gameAbandoned', { playerName });
      return;
    }

    // Verifica se ainda há humanos além do que saiu
    game.botSeats = game.botSeats || new Set();
    const remainingHumans = game.players.filter((p, i) => i !== info.seatIndex && p?.id && !game.botSeats.has(i));

    if (remainingHumans.length === 0) {
      // Nenhum humano restante — encerra a sala
      console.log(`[Room ${info.roomId}] Último humano saiu — encerrando sala`);
      broadcastToRoom(info.roomId, 'gameAbandoned', { playerName });
      rooms.delete(info.roomId);
      roomMeta.delete(info.roomId);
      const meta = roomMeta.get(info.roomId);
      if (meta?.isPublic) broadcastPublicRooms();
      return;
    }

    // ── Substitui pelo bot hard ──
    console.log(`[Room ${info.roomId}] 🤖 ${playerName} saiu voluntariamente — bot hard assume assento ${info.seatIndex}`);
    game.players[info.seatIndex].id = `bot_${info.seatIndex}_${Date.now()}`;
    game.botSeats.add(info.seatIndex);
    game.botDifficulty = 'hard';
    game.paused = false;

    // Transfere liderança se o jogador que saiu era o líder
    if (game.leaderSeatIndex === info.seatIndex) {
      const nextHuman = game.players.findIndex((p, i) => i !== info.seatIndex && p?.id && !game.botSeats.has(i));
      if (nextHuman !== -1) game.leaderSeatIndex = nextHuman;
    }

    broadcastToRoom(info.roomId, 'playerReplacedByBot', { playerName, seatIndex: info.seatIndex });
    broadcastState(game);

    // Inicia turno do bot se for a vez dele
    if (game.status === 'playing' && game.currentPlayerIndex === info.seatIndex) {
      runBotTurns(game, info.roomId, rm, 'hard');
    }

    // Se a rodada estava em roundOver e o líder era o que saiu, auto-continua
    if (game.status === 'roundOver' && game.leaderSeatIndex === info.seatIndex) {
      setTimeout(() => {
        if (game.status !== 'roundOver') return;
        game.startRound();
        broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
        broadcastState(game);
        runBotTurns(game, info.roomId, rm, 'hard');
      }, 3000);
    }

    const meta = roomMeta.get(info.roomId);
    if (meta?.isPublic) broadcastPublicRooms();
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
    broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
    broadcastState(game);
    cb?.({ ok: true });
    runBotTurns(game, info.roomId, rm);
  });
}

module.exports = { registerGameHandlers };
