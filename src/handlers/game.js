'use strict';

// Executa turnos dos bots enquanto for a vez deles
function runBotTurns(game, roomId, rm) {
  if (!game.testMode || game.status !== 'playing') return;
  if (!game.botSeats.has(game.currentPlayerIndex)) return;

  setTimeout(() => {
    if (!game.testMode || game.status !== 'playing') return;
    const botIdx = game.currentPlayerIndex;
    if (!game.botSeats.has(botIdx)) return;

    const drawResult = game.drawFromDeck(botIdx);
    if (!drawResult.ok) return;

    // Descarta a carta de menor valor (evita curingas e ás)
    const RANK_PTS = { '3': 1, '4': 1, '5': 1, '6': 1, '7': 2, '8': 2, '9': 2, '10': 2, 'J': 2, 'Q': 2, 'K': 2, '2': 3, 'A': 4 };
    const hand = game.hands[botIdx];
    const card = [...hand].sort((a, b) => (RANK_PTS[a.rank] || 1) - (RANK_PTS[b.rank] || 1))[0];

    const discardResult = game.discard_(botIdx, card.id);
    rm.broadcastState(game);

    if (discardResult.autoBater || discardResult.deckEndRound) {
      rm.broadcastToRoom(roomId, 'roundEnded', discardResult);
      return;
    }
    if (discardResult.ok) runBotTurns(game, roomId, rm);
  }, 500);
}

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

  socket.on('drawFromDeck', gameAction((game, info, _, cb) => {
    const result = game.drawFromDeck(info.seatIndex);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    socket.to(info.roomId).emit('playerDrew', {});
    broadcastState(game);
    if (result.deckNowEmpty) {
      broadcastToRoom(info.roomId, 'deckEmpty', { playerName: game.players[info.seatIndex]?.name });
    }
  }));

  socket.on('takeDiscard', gameAction((game, info, _, cb) => {
    const result = game.takeDiscard(info.seatIndex);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    socket.to(info.roomId).emit('playerTookDiscard', {});
    broadcastState(game);
  }));

  socket.on('playMelds', gameAction((game, info, { meldActions }, cb) => {
    const result = game.playMelds(info.seatIndex, meldActions);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true, meldTypes: result.meldTypes });
    socket.to(info.roomId).emit('playerDealt', {});
    if (result.autoBater) broadcastToRoom(info.roomId, 'roundEnded', result);
    broadcastState(game);
  }));

  socket.on('discard', gameAction((game, info, { cardId }, cb) => {
    const result = game.discard_(info.seatIndex, cardId);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });
    cb?.({ ok: true });
    if (result.autoBater || result.deckEndRound) {
      broadcastToRoom(info.roomId, 'roundEnded', result);
    } else {
      runBotTurns(game, info.roomId, rm);
    }
    broadcastState(game);
  }));

  socket.on('bater', gameAction((game, info, { discardCardId = null } = {}, cb) => {
    const result = game.bater(info.seatIndex, discardCardId);
    if (!result.ok) return cb?.({ ok: false, msg: result.msg });

    broadcastToRoom(info.roomId, 'roundEnded', result);
    broadcastState(game);
    cb?.({ ok: true, result });

    // Next round only starts when someone clicks "Continuar"
  }));

  socket.on('continueRound', gameAction((game, info, _, cb) => {
    if (game.status !== 'roundOver') return cb?.({ ok: false, msg: 'Não há rodada aguardando.' });
    if (info.seatIndex !== (game.leaderSeatIndex ?? 0)) return cb?.({ ok: false, msg: 'Apenas o líder da sala pode iniciar a próxima rodada.' });
    game.startRound();
    broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
    broadcastState(game);
    cb?.({ ok: true });
    runBotTurns(game, info.roomId, rm);
  }));

  // ── DEV: ajustar pontos em sala de teste ──
  socket.on('setTestScores', (data, cb) => {
    const info = playerRoom.get(socket.id);
    if (!info) return cb?.({ ok: false, msg: 'Não está em uma sala.' });
    const game = rooms.get(info.roomId);
    if (!game?.testMode) return cb?.({ ok: false, msg: 'Apenas em sala de teste.' });
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
  });
}

module.exports = { registerGameHandlers };
