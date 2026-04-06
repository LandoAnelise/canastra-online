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

function fakeDraw(g, playerIndex) {
  g.drawnThisTurn = true;
  g._turnStartedNeverPlayed = !g.hasPlayedMelds[playerIndex];
}

function wild(n = 1) { return card('2', '♠', n); }

// ─── Estender melds existentes (type: 'add') ─────────────────────────────────

describe('Estender melds existentes', () => {

  test('14.1 Adicionar natural a grupo existente aumenta o meld', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1)];
    g.hands[0] = [...kings, card('K','♣',1), card('3','♠',1), card('3','♥',1)];
    fakeDraw(g, 0);
    // Baixa trinca de Ks
    g.playMelds(0, [{ type: 'new', cards: kings.map(c => c.id) }]);
    // Agora adiciona o 4º K
    fakeDraw(g, 0);
    const res = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [card('K','♣',1).id] }]);
    assert.ok(res.ok, 'Deve aceitar adicionar natural ao grupo');
    assert.equal(g.melds[0][0].cards.length, 4);
  });

  test('14.2 Adicionar natural a sequência existente aumenta o meld', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const seq = [card('5','♥',1), card('6','♥',1), card('7','♥',1)];
    g.hands[0] = [...seq, card('8','♥',1), card('3','♠',1), card('3','♥',1)];
    fakeDraw(g, 0);
    g.playMelds(0, [{ type: 'new', cards: seq.map(c => c.id) }]);
    fakeDraw(g, 0);
    const res = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [card('8','♥',1).id] }]);
    assert.ok(res.ok, 'Deve aceitar estender sequência');
    assert.equal(g.melds[0][0].cards.length, 4);
  });

  test('14.3 Adicionar carta de tipo errado ao meld: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1)];
    g.hands[0] = [...kings, card('Q','♠',1), card('3','♠',1), card('3','♥',1)];
    fakeDraw(g, 0);
    g.playMelds(0, [{ type: 'new', cards: kings.map(c => c.id) }]);
    fakeDraw(g, 0);
    // Q não é do rank K → inválido
    const res = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [card('Q','♠',1).id] }]);
    assert.ok(!res.ok);
  });

  test('14.4 Adicionar coringa a grupo com 6 cartas → canastra suja', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const sixKings = [1,2,3,4,5,6].map(n => card('K', ['♠','♥','♦','♣','♠','♥'][n-1], n));
    g.hands[0] = [...sixKings, wild(1), card('3','♠',1)];
    fakeDraw(g, 0);
    g.playMelds(0, [{ type: 'new', cards: sixKings.map(c => c.id) }]);
    fakeDraw(g, 0);
    const res = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [wild(1).id] }]);
    assert.ok(res.ok, 'Deve aceitar coringa no grupo com 6 cartas');
    assert.equal(g.melds[0][0].cards.length, 7, 'Grupo deve ter 7 cartas (canastra)');
  });

  test('14.5 Adicionar 2º coringa a grupo misto: recusado (máx 1 coringa por grupo)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    // Grupo: K♠ K♥ K♦ K♣ K♠2 K♥2 + coringa = 7 cartas com 1 coringa
    const fiveKings = [1,2,3,4,5].map(n => card('K', ['♠','♥','♦','♣','♠'][n-1], n));
    const w1 = wild(1);
    g.hands[0] = [...fiveKings, w1, wild(2), card('3','♠',1)];
    fakeDraw(g, 0);
    g.playMelds(0, [{ type: 'new', cards: fiveKings.map(c => c.id) }]);
    fakeDraw(g, 0);
    // Adiciona 1º coringa (ok)
    const r1 = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [w1.id] }]);
    assert.ok(r1.ok, '1º coringa deve ser aceito');
    fakeDraw(g, 0);
    // Tenta adicionar 2º coringa (deve recusar)
    const r2 = g.playMelds(0, [{ type: 'add', meldIndex: 0, cards: [wild(2).id] }]);
    assert.ok(!r2.ok, '2º coringa em grupo misto deve ser recusado');
  });

  test('14.6 Novo grupo com 2 coringas: recusado pela engine', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const cards = [card('K','♠',1), card('K','♥',1), wild(1), wild(2)];
    g.hands[0] = [...cards, card('3','♠',1)];
    fakeDraw(g, 0);
    const res = g.playMelds(0, [{ type: 'new', cards: cards.map(c => c.id) }]);
    assert.ok(!res.ok, 'Grupo com 2 coringas deve ser recusado');
  });

});

// ─── Múltiplas rodadas ────────────────────────────────────────────────────────

describe('Múltiplas rodadas', () => {

  test('15.1 Pontuação acumula entre rodadas', () => {
    const g = setupGame();
    // Força fim da rodada manualmente
    g.scores[0] = 200;
    g.scores[1] = 100;
    const prevS0 = g.scores[0];
    const prevS1 = g.scores[1];
    // Simula batida sem bônus (noBaterBonus)
    g._batterIndex = 0;
    g.status = 'roundOver';
    g.startRound();
    // Pontuações devem se manter (startRound não zera scores)
    assert.equal(g.scores[0], prevS0);
    assert.equal(g.scores[1], prevS1);
  });

  test('15.2 hasFirstMeld reseta a cada rodada (buraco re-aplica em cada round)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.scores[0] = 200;
    g.startRound();
    assert.ok(!g.hasFirstMeld[0], 'hasFirstMeld deve resetar ao iniciar nova rodada');
  });

  test('15.3 Mãos são redistribuídas ao iniciar nova rodada', () => {
    const g = setupGame();
    g.startRound();
    assert.equal(g.hands[0].length, 13, 'Deve ter 13 cartas na nova rodada');
    // Primeiro jogador é obrigado a pescar — lixo começa vazio
    assert.equal(g.discard.length, 0, 'Lixo deve começar vazio (1º jogador obrigado a pescar)');
  });

  test('15.4 Jogo atinge status finished ao cruzar 2000 pts', () => {
    const g = setupGame();
    g.scores[0] = 1990;
    // Forçar batida direta
    g.melds[0].push({ type: 'group', rank: 'K', suit: '♠', cards: [1,2,3,4,5,6,7].map(n => card('K','♠',n)) });
    g._batterIndex = 0;
    const result = g._endRound(0, false, false);
    assert.equal(g.status, 'finished');
  });

});

// ─── Restrição tookSingleDiscardId ───────────────────────────────────────────

describe('Restrição de retirada única do lixo', () => {

  test('16.1 Carta tirada de lixo com 1 carta não pode ser descartada no mesmo turno', () => {
    const g = setupGame();
    // Garante que mão tem 2 cartas (mais do que 1 para não forçar pesca)
    g.hands[0] = [card('K','♠',1), card('K','♥',1), card('K','♦',1)];
    g.hands[0].push(card('A','♠',1), card('A','♥',1));
    // Coloca 2 cartas no lixo para não cair na restrição de pile=1 + hand=1
    g.discard = [card('3','♦',1), card('Q','♠',1)];
    const topCard = g.discard[g.discard.length - 1];
    g.takeDiscard(0);
    // Tenta descartar a carta recém tirada do lixo (quando era única)
    // Na verdade pile tinha 2 cartas — tookSingleDiscardId só é setado para pile de 1 carta
    // Vamos testar o caso correto: pile com 1 carta
    const g2 = setupGame();
    g2.hands[0] = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('A','♠',1)];
    const onlyDiscard = card('Q','♠',1);
    g2.discard = [onlyDiscard];
    const res = g2.takeDiscard(0);
    assert.ok(res.ok, 'Deve conseguir pegar lixo com 1 carta');
    assert.equal(g2.tookSingleDiscardId, onlyDiscard.id);
    // Tenta descartar a mesma carta
    const discardRes = g2.discard_(0, onlyDiscard.id);
    assert.ok(!discardRes.ok, 'Não pode descartar a carta que acabou de tirar do lixo único');
  });

  test('16.2 Pode descartar outra carta após pegar lixo único', () => {
    const g = setupGame();
    const other = card('3','♦',1);
    const onlyDiscard = card('Q','♠',1);
    g.hands[0] = [card('K','♠',1), card('K','♥',1), card('K','♦',1), other];
    g.discard = [onlyDiscard];
    g.takeDiscard(0);
    const res = g.discard_(0, other.id);
    assert.ok(res.ok, 'Deve poder descartar outra carta');
  });

});

// ─── Regra do buraco — threshold 150 após penalidade ─────────────────────────

describe('Buraco — penalidade e threshold 150', () => {

  test('17.1 No buraco com penalidade: stageMeld + confirmação com 100 pts é recusada (precisa 150)', () => {
    const g = setupGame();
    g.scores[0] = 1100;
    // Simula penalidade já aplicada (como faz o confirmStagedMelds)
    g.firstMeldPenalty[0] = true;
    const aces  = [1,2,3,4].map(n => card('A',['♠','♥','♦','♣'][n-1],n));
    const kings = [1,2,3,4].map(n => card('K',['♠','♥','♦','♣'][n-1],n));
    g.hands[0] = [...aces, ...kings, card('3','♠',1), card('3','♥',1), card('3','♦',1)];
    fakeDraw(g, 0);
    // Coloca em espera via stageMeld
    g.stageMeld(0, aces.map(c => c.id));
    g.stageMeld(0, kings.map(c => c.id));
    // Confirma: 4As (60) + 4Ks (40) = 100 pts — insuficiente com threshold 150
    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok, '100 pts deve ser recusado com threshold 150 pós-penalidade');
    assert.match(res.msg, /150/);
  });

  test('17.2 No buraco com penalidade: 150 pts é aceito', () => {
    const g = setupGame();
    g.scores[0] = 1100;
    g.firstMeldPenalty[0] = true;
    // 4As (60) + 4Ks (40) + 4Qs (40) = 140 — ainda não chega... vamos usar 4As + canastra de Ks = 60+140=200
    const aces  = [1,2,3,4].map(n => card('A',['♠','♥','♦','♣'][n-1],n));
    const kings = [1,2,3,4,5,6,7].map(n => card('K',['♠','♥','♦','♣','♠','♥','♦'][n-1],n));
    g.hands[0] = [...aces, ...kings, card('3','♠',1)];
    fakeDraw(g, 0);
    const res = g.playMelds(0, [
      { type: 'new', cards: aces.map(c => c.id) },
      { type: 'new', cards: kings.map(c => c.id) },
    ]);
    assert.ok(res.ok, '60+140=200 pts deve ser aceito com threshold 150');
    assert.ok(g.hasFirstMeld[0]);
  });

});
