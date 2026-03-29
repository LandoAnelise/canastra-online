'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/GameEngine.js');

function card(rank, suit, n = 1) {
  return { id: `${rank}${suit}-${n}`, rank, suit };
}

function setupGame() {
  const g = new Game('test');
  ['Alice', 'Bob', 'Carol', 'Dave'].forEach((name, i) => g.addPlayer(`p${i}`, name));
  g.assignTeams(
    [{ seatIndex: 0, teamIndex: 0 }, { seatIndex: 1, teamIndex: 1 },
     { seatIndex: 2, teamIndex: 0 }, { seatIndex: 3, teamIndex: 1 }],
    { 0: [0, 2], 1: [1, 3] }
  );
  g.startRound();
  return g;
}

describe('Monte vazio: encerramento automático ao descartar', () => {

  test('1. Jogador pescou a última carta, descarta → deckEndRound, rodada encerrada', () => {
    const g = setupGame();

    // Configura: dupla 0 já tem canastra na mesa
    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    // Esvazia o baralho e simula que o jogador 0 pescou a última carta
    g.deck = [card('3','♣',99)]; // última carta
    g.drawnThisTurn = false;
    const draw = g.drawFromDeck(0);
    assert.ok(draw.ok);
    assert.equal(g.deckEmptyLastDrawer, 0, 'Deve marcar jogador 0 como último a pescar');

    // Jogador descarta uma carta → deve encerrar a rodada
    const discardCard = g.hands[0][0];
    const result = g.discard_(0, discardCard.id);

    assert.ok(result.deckEndRound, 'Esperado deckEndRound = true');
    assert.ok(result.ok, 'Resultado deve ser ok');
    assert.notEqual(g.status, 'playing', 'Status não deve ser "playing" após encerramento');
  });

  test('2. Após deckEndRound, bater() deve ser recusado pelo servidor', () => {
    const g = setupGame();

    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    // Pescou a última carta
    g.deck = [card('3','♣',99)];
    g.drawnThisTurn = false;
    g.drawFromDeck(0);

    // Descarta → encerra rodada
    const discardCard = g.hands[0][0];
    const discardResult = g.discard_(0, discardCard.id);
    assert.ok(discardResult.deckEndRound);

    // Tenta bater depois — deve ser recusado
    const baterResult = g.bater(0);
    assert.ok(!baterResult.ok, 'bater() deve ser recusado após fim de rodada');
    assert.equal(baterResult.msg, 'A rodada já foi encerrada.',
      `Mensagem esperada: "A rodada já foi encerrada.", recebida: "${baterResult.msg}"`);
  });

  test('3. Após deckEndRound, um segundo discard() deve ser recusado', () => {
    const g = setupGame();

    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    g.deck = [card('3','♣',99)];
    g.drawnThisTurn = false;
    g.drawFromDeck(0);

    const firstCard = g.hands[0][0];
    g.discard_(0, firstCard.id); // encerra rodada

    // Ainda sobra carta na mão — tenta descartar de novo
    if (g.hands[0].length > 0) {
      const secondCard = g.hands[0][0];
      const secondDiscard = g.discard_(0, secondCard.id);
      assert.ok(!secondDiscard.ok, 'Segundo discard deve ser recusado após fim de rodada');
    }
    // Se não sobrou carta, o teste passa trivialmente — rodada encerrada de qualquer forma
    assert.notEqual(g.status, 'playing');
  });

});
