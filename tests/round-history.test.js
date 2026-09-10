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
    [
      { seatIndex: 0, teamIndex: 0 },
      { seatIndex: 1, teamIndex: 1 },
      { seatIndex: 2, teamIndex: 0 },
      { seatIndex: 3, teamIndex: 1 },
    ],
    { 0: [0, 2], 1: [1, 3] },
  );
  g.startRound();
  return g;
}

// Encerra uma rodada com um número controlado de pontos na mesa da dupla vencedora.
function endRoundWith(g, winningTeam, canastaCount = 1) {
  g.melds[winningTeam] = [];
  for (let c = 0; c < canastaCount; c++) {
    g.melds[winningTeam].push({
      type: 'group',
      rank: 'K',
      suit: '♠',
      cards: [1, 2, 3, 4, 5, 6, 7].map((n) => card('K', '♠', n + c * 7)),
    });
  }
  g.hands = [[], [], [], []];
  g._batterIndex = g.playOrder.find((p) => g.players[p].teamIndex === winningTeam);
  return g._endRound(winningTeam, false, false);
}

describe('roundHistory — histórico de pontos por rodada', () => {
  test('1. Começa vazio', () => {
    const g = setupGame();
    assert.deepEqual(g.roundHistory, []);
  });

  test('2. Cada rodada encerrada adiciona uma entrada com pontos e acumulado', () => {
    const g = setupGame();

    const r1 = endRoundWith(g, 0, 1); // canastra limpa de K: 70 + 200 + 100 (bater) = 370
    assert.equal(g.roundHistory.length, 1);
    assert.equal(g.roundHistory[0].round, 1);
    assert.deepEqual(g.roundHistory[0].roundPoints, r1.roundPoints);
    assert.deepEqual(g.roundHistory[0].scores, [...g.scores]);

    g.startRound(); // round 2
    const r2 = endRoundWith(g, 1, 1);
    assert.equal(g.roundHistory.length, 2);
    assert.equal(g.roundHistory[1].round, 2);
    assert.deepEqual(g.roundHistory[1].roundPoints, r2.roundPoints);
    assert.deepEqual(g.roundHistory[1].scores, [...g.scores]);
  });

  test('3. Soma dos roundPoints por dupla bate com o placar final', () => {
    const g = setupGame();
    endRoundWith(g, 0, 1);
    g.startRound();
    endRoundWith(g, 0, 2);
    g.startRound();
    endRoundWith(g, 1, 1);

    const totalT0 = g.roundHistory.reduce((s, h) => s + h.roundPoints[0], 0);
    const totalT1 = g.roundHistory.reduce((s, h) => s + h.roundPoints[1], 0);
    assert.equal(totalT0, g.scores[0]);
    assert.equal(totalT1, g.scores[1]);
  });

  test('4. O acumulado (scores) em cada entrada é monotônico do jogo', () => {
    const g = setupGame();
    endRoundWith(g, 0, 1);
    const afterR1 = g.roundHistory[0].scores[0];
    g.startRound();
    endRoundWith(g, 0, 1);
    const afterR2 = g.roundHistory[1].scores[0];
    assert.equal(afterR2, afterR1 + g.roundHistory[1].roundPoints[0]);
  });

  test('5. _endRound devolve uma cópia de roundHistory no resultado', () => {
    const g = setupGame();
    const res = endRoundWith(g, 0, 1);
    assert.ok(Array.isArray(res.roundHistory));
    assert.equal(res.roundHistory.length, 1);
    // cópia — mutar o resultado não afeta o estado do jogo
    res.roundHistory[0].roundPoints[0] = 99999;
    assert.notEqual(g.roundHistory[0].roundPoints[0], 99999);
  });

  test('6. getStateFor expõe roundHistory para reconexão', () => {
    const g = setupGame();
    endRoundWith(g, 0, 1);
    const st = g.getStateFor(1);
    assert.ok(Array.isArray(st.roundHistory));
    assert.equal(st.roundHistory.length, 1);
  });

  test('7. roundHistory persiste ao longo de rodadas até o fim do jogo', () => {
    const g = setupGame();
    g.scores = [1990, 0];
    const res = endRoundWith(g, 0, 1); // cruza 2000 → finished
    assert.equal(g.status, 'finished');
    assert.ok(res.gameOver);
    assert.equal(g.roundHistory.length, 1);
    assert.deepEqual(g.roundHistory[0].scores, [...g.scores]);
  });
});
