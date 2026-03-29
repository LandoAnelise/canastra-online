'use strict';

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
    if (result.autoBater || result.deckEndRound) broadcastToRoom(info.roomId, 'roundEnded', result);
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
    broadcastToRoom(info.roomId, 'roundStarted', { round: game.round });
    broadcastState(game);
    cb?.({ ok: true });
  });
}

module.exports = { registerGameHandlers };
