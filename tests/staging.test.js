'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/GameEngine.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    { 0: [0, 2], 1: [1, 3] }
  );
  g.startRound();
  return g;
}

/** Simula compra sem tirar carta do baralho. */
function fakeDraw(g, playerIndex) {
  g.drawnThisTurn = true;
  g._turnStartedNeverPlayed = !g.hasPlayedMelds[playerIndex];
}

// ─── Testes: stageMeld ────────────────────────────────────────────────────────

describe('stageMeld — validações básicas', () => {

  test('1. Recusa se não for a vez do jogador', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    fakeDraw(g, 0);
    const cards = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    g.hands[1] = cards;
    const res = g.stageMeld(1, cards.map(c => c.id));
    assert.ok(!res.ok);
    assert.match(res.msg, /vez/i);
  });

  test('2. Recusa se não comprou ainda', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const cards = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    g.hands[0] = cards;
    const res = g.stageMeld(0, cards.map(c => c.id));
    assert.ok(!res.ok);
    assert.match(res.msg, /comprar/i);
  });

  test('3. Recusa se a dupla já tem hasFirstMeld', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const cards = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    g.hands[0] = cards;
    const res = g.stageMeld(0, cards.map(c => c.id));
    assert.ok(!res.ok);
    assert.match(res.msg, /já baixou/i);
  });

  test('4. Recusa combinação inválida (2 cartas apenas)', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    fakeDraw(g, 0);
    const cards = [card('K', '♠', 1), card('K', '♥', 1)];
    g.hands[0] = cards;
    const res = g.stageMeld(0, cards.map(c => c.id));
    assert.ok(!res.ok);
  });

  test('5. Aceita trinca válida e remove as cartas da mão', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const trinca = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    const resto  = [card('3', '♠', 1), card('4', '♠', 1)];
    g.hands[0] = [...trinca, ...resto];
    fakeDraw(g, 0);

    const res = g.stageMeld(0, trinca.map(c => c.id));
    assert.ok(res.ok, res.msg);
    assert.equal(g.stagedMelds[0].length, 1, 'Deve ter 1 meld em espera');
    assert.equal(g.hands[0].length, 2, 'Trinca deve ser removida da mão');
    assert.equal(g.stagedMelds[0][0].cards.length, 3);
  });

  test('6. Permite múltiplos stageMeld no mesmo turno', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const trinca1 = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    const trinca2 = [card('Q', '♠', 1), card('Q', '♥', 1), card('Q', '♦', 1)];
    g.hands[0] = [...trinca1, ...trinca2];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, trinca1.map(c => c.id)).ok);
    assert.ok(g.stageMeld(0, trinca2.map(c => c.id)).ok);
    assert.equal(g.stagedMelds[0].length, 2);
    assert.equal(g.hands[0].length, 0);
  });

});

// ─── Testes: confirmStagedMelds ───────────────────────────────────────────────

describe('confirmStagedMelds — commit com pontos suficientes', () => {

  test('7. Trinca de Ks (30 pts) — sem buraco — NÃO usa staging (só stageMeld recusa)', () => {
    // Confirma que stageMeld é bloqueado quando hasFirstMeld já é true
    const g = setupGame();
    g.scores[0] = 500; // abaixo de 1000 — não está no buraco
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const cards = [card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1)];
    g.hands[0] = cards;
    const res = g.stageMeld(0, cards.map(c => c.id));
    assert.ok(!res.ok); // staging recusado porque já tem hasFirstMeld
  });

  test('8. Buraco: 4As + 4Ks = 100 pts → confirmação OK, melds comprometidos', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)];
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)];
    const junk  = [card('3','♠',1), card('4','♠',1)];
    g.hands[0] = [...aces, ...kings, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, aces.map(c => c.id)).ok);
    assert.ok(g.stageMeld(0, kings.map(c => c.id)).ok);

    const res = g.confirmStagedMelds(0);
    assert.ok(res.ok, res.msg);
    assert.ok(g.hasFirstMeld[0], 'hasFirstMeld deve ser true após confirmação');
    assert.equal(g.melds[0].length, 2, 'Deve ter 2 melds na mesa');
    assert.equal(g.stagedMelds[0].length, 0, 'staged deve estar vazio');
    assert.equal(g.hands[0].length, 2, '2 cartas de lixo devem permanecer na mão');
  });

  test('9. Confirmar sem cartas em espera retorna erro', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    fakeDraw(g, 0);
    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /espera/i);
  });

});

// ─── Testes: penalidade ───────────────────────────────────────────────────────

describe('confirmStagedMelds — penalidade por pontos insuficientes', () => {

  test('10. Trinca de 3s (15 pts) no buraco → penalidade, cartas voltam à mão', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const trinca = [card('3','♠',1), card('3','♥',1), card('3','♦',1)]; // 15 pts (< 100)
    const junk   = [card('4','♠',1), card('5','♠',1)];
    g.hands[0] = [...trinca, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, trinca.map(c => c.id)).ok);
    assert.equal(g.hands[0].length, 2, 'Mão deveria ter 2 cartas após staging');

    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok, 'Deve recusar com pontos insuficientes');
    assert.ok(res.penalized, 'Deve aplicar penalidade');
    assert.equal(g.firstMeldPenalty[0], true, 'firstMeldPenalty deve ser true');
    assert.equal(g.hands[0].length, 5, 'Todas as cartas devem voltar à mão');
    assert.equal(g.stagedMelds[0].length, 0, 'staged deve estar vazio');
    assert.equal(g.melds[0].length, 0, 'Nenhum meld deve ter sido comprometido');
  });

  test('11. Após penalidade, precisa de 150 pts — 100 pts não é suficiente', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.firstMeldPenalty[0] = true; // já penalizado
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)]; // 60 pts
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)]; // 40 pts → total 100
    const junk  = [card('3','♠',1), card('4','♠',1)];
    g.hands[0] = [...aces, ...kings, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, aces.map(c => c.id)).ok);
    assert.ok(g.stageMeld(0, kings.map(c => c.id)).ok);

    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok, '100 pts não suficiente quando há penalidade (precisa 150)');
    assert.ok(!res.penalized, 'Não deve repenalizar — penalidade já estava ativa');
    assert.equal(g.hands[0].length, 10, 'Cartas voltam à mão');
  });

  test('12. Após penalidade, 150 pts → confirmação OK', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.firstMeldPenalty[0] = true;
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)]; // 60 pts
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)]; // 40 pts
    const queens= [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1)]; // 30 pts → total 130 pts (< 150)
    // na verdade precisamos de 150 — usemos 4Qs = 40 pts (total 140), ainda não chega
    // Vamos usar 7 Qs (canastra = 70 pts de cartas + 100 bônus = 170 pts > 150)
    const queenCanasta = [
      card('Q','♠',1), card('Q','♥',1), card('Q','♦',1), card('Q','♣',1),
      card('Q','♠',2), card('Q','♥',2), card('Q','♦',2),
    ]; // 70 pts cartas + 100 pts canastra suja = 170 pts
    const junk = [card('3','♠',1), card('4','♠',1)];
    g.hands[0] = [...queenCanasta, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, queenCanasta.map(c => c.id)).ok);

    const res = g.confirmStagedMelds(0);
    assert.ok(res.ok, res.msg);
    assert.ok(g.hasFirstMeld[0]);
    assert.equal(g.melds[0].length, 1);
  });

  test('13. Penalidade não é aplicada duas vezes', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.firstMeldPenalty[0] = true; // já penalizado

    const trinca = [card('3','♠',1), card('3','♥',1), card('3','♦',1)]; // 15 pts
    const junk   = [card('4','♠',1), card('5','♠',1)];
    g.hands[0] = [...trinca, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, trinca.map(c => c.id)).ok);
    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok);
    assert.equal(res.penalized, false, 'penalized deve ser false quando penalidade já existia');
    assert.equal(g.firstMeldPenalty[0], true, 'penalidade não deve ser duplicada');
  });

});

// ─── Testes: getStateFor expõe staging ───────────────────────────────────────

describe('getStateFor — staged melds visíveis a todos', () => {

  test('14. stagedMelds do jogador 0 são visíveis no estado do jogador 1', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const trinca = [card('K','♠',1), card('K','♥',1), card('K','♦',1)];
    const junk   = [card('3','♠',1), card('4','♠',1)];
    g.hands[0] = [...trinca, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, trinca.map(c => c.id)).ok);

    const stateFor1 = g.getStateFor(1);
    assert.equal(stateFor1.stagedMelds[0].length, 1, 'Jogador 1 deve ver os staged melds do jogador 0');
    assert.equal(stateFor1.stagedMelds[0][0].cards.length, 3);
  });

  test('15. firstMeldPenalty é exposta no estado para todos', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.firstMeldPenalty[0] = true;

    const stateFor2 = g.getStateFor(2);
    assert.equal(stateFor2.firstMeldPenalty[0], true);
  });

  test('16. Após confirmação bem-sucedida, stagedMelds fica vazio no estado', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)];
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)];
    const junk  = [card('3','♠',1), card('4','♠',1)];
    g.hands[0] = [...aces, ...kings, ...junk];
    fakeDraw(g, 0);

    assert.ok(g.stageMeld(0, aces.map(c => c.id)).ok);
    assert.ok(g.stageMeld(0, kings.map(c => c.id)).ok);
    assert.ok(g.confirmStagedMelds(0).ok);

    const stateFor1 = g.getStateFor(1);
    assert.equal(stateFor1.stagedMelds[0].length, 0, 'staged deve estar vazio após confirmação');
    assert.equal(stateFor1.melds[0].length, 2, 'melds comprometidos devem estar na mesa');
  });

});

// ─── Testes: auto-bater via staging ──────────────────────────────────────────

describe('confirmStagedMelds — auto-bater', () => {

  test('17. Confirmar canastra que esgota a mão → auto-bater com bônus 100 (batida limpa)', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const canasta = [
      card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
      card('K','♠',2), card('K','♥',2), card('K','♦',2),
    ]; // 7 Ks = canastra limpa (7 * 10 = 70 pts + 200 bônus = 270 pts)
    g.hands[0] = canasta;
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true

    assert.ok(g.stageMeld(0, canasta.map(c => c.id)).ok);

    const res = g.confirmStagedMelds(0);
    assert.ok(res.ok, res.msg);
    assert.ok(res.autoBater, 'Deve ter auto-bater ao confirmar com mão vazia e canastra');
    assert.equal(res.teamMeldDetails[0].baterBonus, 100,
      'Batida limpa (nunca baixou antes) deve valer 100 pts');
  });

});
