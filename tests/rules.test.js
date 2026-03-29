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

function playNew(g, playerIndex, cards) {
  return g.playMelds(playerIndex, [{ type: 'new', cards: cards.map(c => c.id) }]);
}

function group7(rank) {
  return [
    card(rank, '♠', 1), card(rank, '♥', 1), card(rank, '♦', 1), card(rank, '♣', 1),
    card(rank, '♠', 2), card(rank, '♥', 2), card(rank, '♦', 2),
  ];
}

// ─── 1. Configuração ─────────────────────────────────────────────────────────

describe('Configuração da partida', () => {

  test('1.1 Não pode adicionar 5º jogador', () => {
    const g = new Game('t');
    for (let i = 0; i < 4; i++) g.addPlayer(`p${i}`, `J${i}`);
    const res = g.addPlayer('p5', 'Extra');
    assert.ok(!res.ok);
    assert.match(res.msg, /cheia/i);
  });

  test('1.2 assignTeams exige exatamente 2 jogadores por dupla', () => {
    const g = new Game('t');
    for (let i = 0; i < 4; i++) g.addPlayer(`p${i}`, `J${i}`);
    const res = g.assignTeams([
      { seatIndex: 0, teamIndex: 0 },
      { seatIndex: 1, teamIndex: 0 },
      { seatIndex: 2, teamIndex: 0 },
      { seatIndex: 3, teamIndex: 1 },
    ]);
    assert.ok(!res.ok);
    assert.match(res.msg, /2 jogadores/i);
  });

  test('1.3 Cada jogador recebe 13 cartas ao iniciar rodada', () => {
    const g = setupGame();
    for (let i = 0; i < 4; i++) {
      assert.equal(g.hands[i].length, 13, `Jogador ${i} deve ter 13 cartas`);
    }
  });

  test('1.4 Baralho tem 104 cartas; após distribuir restam 104 − 52 = 52', () => {
    const g = setupGame();
    assert.equal(g.deck.length, 52);
  });

  test('1.5 playOrder é intercalado entre duplas (T0P0, T1P0, T0P1, T1P1)', () => {
    const g = setupGame();
    // Com assignTeams 0:[0,2] 1:[1,3] → playOrder = [0,1,2,3]
    assert.deepEqual(g.playOrder, [0, 1, 2, 3]);
    assert.equal(g.players[g.playOrder[0]].teamIndex, 0);
    assert.equal(g.players[g.playOrder[1]].teamIndex, 1);
    assert.equal(g.players[g.playOrder[2]].teamIndex, 0);
    assert.equal(g.players[g.playOrder[3]].teamIndex, 1);
  });

});

// ─── 2. Turno ────────────────────────────────────────────────────────────────

describe('Regras de turno', () => {

  test('2.1 Não pode jogar fora da sua vez', () => {
    const g = setupGame();
    fakeDraw(g, 0);
    g.hasFirstMeld[1] = true;
    const res = g.playMelds(1, [{ type: 'new', cards: [g.hands[1][0].id, g.hands[1][1].id, g.hands[1][2].id] }]);
    assert.ok(!res.ok);
    assert.match(res.msg, /vez/i);
  });

  test('2.2 Não pode descartar sem ter comprado', () => {
    const g = setupGame();
    const res = g.discard_(0, g.hands[0][0].id);
    assert.ok(!res.ok);
    assert.match(res.msg, /comprar/i);
  });

  test('2.3 Não pode baixar sem ter comprado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const kings = group7('K');
    g.hands[0] = kings;
    const res = playNew(g, 0, kings);
    assert.ok(!res.ok);
    assert.match(res.msg, /comprar/i);
  });

  test('2.4 Não pode comprar duas vezes no mesmo turno', () => {
    const g = setupGame();
    g.drawFromDeck(0);
    const res = g.drawFromDeck(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /já comprou/i);
  });

  test('2.5 Turno avança após descartar', () => {
    const g = setupGame();
    g.drawFromDeck(0);
    const before = g.currentPlayerIndex;
    g.discard_(0, g.hands[0][0].id);
    assert.notEqual(g.currentPlayerIndex, before);
    assert.equal(g.currentPlayerIndex, g.playOrder[1]);
  });

  test('2.6 drawnThisTurn resetado após descartar', () => {
    const g = setupGame();
    g.drawFromDeck(0);
    g.discard_(0, g.hands[0][0].id);
    assert.equal(g.drawnThisTurn, false);
  });

});

// ─── 3. Compra ───────────────────────────────────────────────────────────────

describe('Compra do monte e do lixo', () => {

  test('3.1 Pescar do monte adiciona 1 carta à mão', () => {
    const g = setupGame();
    const before = g.hands[0].length;
    g.drawFromDeck(0);
    assert.equal(g.hands[0].length, before + 1);
  });

  test('3.2 Pegar lixo adiciona todas as cartas do lixo à mão', () => {
    const g = setupGame();
    g.discard = [card('5','♠'), card('6','♠'), card('7','♠')];
    const before = g.hands[0].length;
    const res = g.takeDiscard(0);
    assert.ok(res.ok);
    assert.equal(g.hands[0].length, before + 3);
    assert.equal(g.discard.length, 0);
  });

  test('3.3 Lixo vazio: pegar lixo é recusado', () => {
    const g = setupGame();
    g.discard = [];
    const res = g.takeDiscard(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /vazio/i);
  });

  test('3.4 Com 1 carta na mão e 1 no lixo: obrigado a pescar do monte', () => {
    const g = setupGame();
    g.hands[0] = [card('3','♠')];
    g.discard = [card('4','♠')];
    const res = g.takeDiscard(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /obrigado/i);
  });

  test('3.5 Carta única do lixo não pode ser descartada de volta no mesmo turno', () => {
    const g = setupGame();
    const lixoCard = card('7','♥');
    g.discard = [lixoCard];
    g.hands[0] = [lixoCard, card('3','♠'), card('4','♠')];
    g.takeDiscard(0);
    const res = g.discard_(0, lixoCard.id);
    assert.ok(!res.ok);
    assert.match(res.msg, /não pode descartar/i);
  });

  test('3.6 Monte vazio: drawFromDeck é recusado', () => {
    const g = setupGame();
    g.deck = [];
    const res = g.drawFromDeck(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /vazio/i);
  });

});

// ─── 4. Grupos válidos ────────────────────────────────────────────────────────

describe('Validação de grupos', () => {

  test('4.1 Trinca pura é válida', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('K','♥'), card('K','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('4.2 2 cartas: inválido', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('K','♥')];
    g.hands[0] = [...t, card('3','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('4.3 Ranks diferentes: inválido', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('Q','♥'), card('J','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('4.4 Grupo com 1 coringa atuando: válido (naturais são maioria)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('K','♥'), card('2','♣')]; // 2 naturais, 1 coringa
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('4.5 Coringas são maioria: inválido (2 coringas, 1 natural)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('2','♣'), card('2','♥')]; // 1 natural, 2 coringas
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('4.6 Grupo de 2s puros: válido (todos naturais)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('2','♠'), card('2','♥'), card('2','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

});

// ─── 5. Sequências válidas ────────────────────────────────────────────────────

describe('Validação de sequências', () => {

  test('5.1 Sequência pura de 3 cartas: válida', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('5','♥'), card('6','♥'), card('7','♥')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('5.2 Naipes diferentes: inválido', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('5','♥'), card('6','♠'), card('7','♥')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('5.3 Não consecutivas (lacuna de 2): inválido sem coringa', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('5','♥'), card('7','♥'), card('9','♥')]; // duas lacunas, zero coringas
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('5.4 Sequência com 1 coringa preenchendo lacuna: válida', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('5','♥'), card('2','♠'), card('7','♥')]; // 2♠ como coringa no slot 6♥
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('5.5 Mais de 1 coringa atuando: inválido', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('5','♥'), card('2','♠'), card('2','♣'), card('8','♥')]; // 2 coringas atuando
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(!playNew(g, 0, t).ok);
  });

  test('5.6 Ás baixo: A♥ 2♥ 3♥ (2♥ é natural no slot do rank 2)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('A','♥'), card('2','♥'), card('3','♥')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('5.7 Ás alto: Q♦ K♦ A♦', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('Q','♦'), card('K','♦'), card('A','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

  test('5.8 2 do mesmo naipe na sequência que passa pelo rank 2 é natural (0 coringas atuando)', () => {
    // A♥ 2♥ 3♥: o 2♥ fica no slot do rank 2 — é natural
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const t = [card('A','♥'), card('2','♥'), card('3','♥'), card('4','♥')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    assert.ok(playNew(g, 0, t).ok);
  });

});

// ─── 6. Pontuação das cartas ──────────────────────────────────────────────────

describe('Pontuação das cartas', () => {

  // Testa indiretamente via teamMeldDetails após bater
  function baterComMelds(meldCards) {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = meldCards;
    fakeDraw(g, 0);
    const res = playNew(g, 0, meldCards);
    return res;
  }

  test('6.1 Ás vale 15 pts', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    const aces = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1),
                  card('A','♠',2), card('A','♥',2), card('A','♦',2)];
    g.hands[0] = aces;
    fakeDraw(g, 0);
    const res = playNew(g, 0, aces);
    assert.ok(res.ok && res.autoBater);
    // 7 aces × 15 = 105 pts de cartas
    assert.equal(res.teamMeldDetails[0].cardsPoints,
      7 * 10 + 7 * 15, // 7 Ks (10 pts) + 7 As (15 pts)
      'Ás deve valer 15 pts');
  });

  test('6.2 2 (coringa) vale 10 pts', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    // Grupo de 7 twos (puro — todos naturais)
    const twos = [card('2','♠',1), card('2','♥',1), card('2','♦',1), card('2','♣',1),
                  card('2','♠',2), card('2','♥',2), card('2','♦',2)];
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = twos;
    fakeDraw(g, 0);
    const res = playNew(g, 0, twos);
    assert.ok(res.ok && res.autoBater);
    // 7Ks × 10 + 7 twos × 10 = 140
    assert.equal(res.teamMeldDetails[0].cardsPoints, 140);
  });

  test('6.3 K, Q, J, 10, 9, 8, 7 valem 10 pts cada', () => {
    const ranks = ['K','Q','J','10','9','8','7'];
    for (const rank of ranks) {
      const g = setupGame();
      g.hasFirstMeld[0] = true;
      const canasta = group7(rank);
      g.hands[0] = canasta;
      fakeDraw(g, 0);
      const res = playNew(g, 0, canasta);
      assert.ok(res.ok && res.autoBater, `${rank} falhou`);
      assert.equal(res.teamMeldDetails[0].cardsPoints, 7 * 10,
        `${rank} deve valer 10 pts, obtido: ${res.teamMeldDetails[0].cardsPoints / 7}`);
    }
  });

  test('6.4 3, 4, 5, 6 valem 5 pts cada', () => {
    const ranks = ['3','4','5','6'];
    for (const rank of ranks) {
      const g = setupGame();
      g.hasFirstMeld[0] = true;
      const canasta = group7(rank);
      g.hands[0] = canasta;
      fakeDraw(g, 0);
      const res = playNew(g, 0, canasta);
      assert.ok(res.ok && res.autoBater, `${rank} falhou`);
      assert.equal(res.teamMeldDetails[0].cardsPoints, 7 * 5,
        `${rank} deve valer 5 pts`);
    }
  });

});

// ─── 7. Canastras ────────────────────────────────────────────────────────────

describe('Canastras', () => {

  test('7.1 7 cartas do mesmo rank sem coringa = canastra limpa (+200)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const canasta = group7('K');
    g.hands[0] = canasta;
    fakeDraw(g, 0);
    const res = playNew(g, 0, canasta);
    assert.ok(res.ok && res.autoBater);
    assert.equal(res.teamMeldDetails[0].canastrasLimpas, 1);
    assert.equal(res.teamMeldDetails[0].canastrasSujas, 0);
  });

  test('7.2 7 cartas com 1 coringa atuando = canastra suja (+100)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const canasta = [
      card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
      card('K','♠',2), card('K','♥',2), card('2','♣',1), // coringa atuando
    ];
    g.hands[0] = canasta;
    fakeDraw(g, 0);
    const res = playNew(g, 0, canasta);
    assert.ok(res.ok && res.autoBater);
    assert.equal(res.teamMeldDetails[0].canastrasLimpas, 0);
    assert.equal(res.teamMeldDetails[0].canastrasSujas, 1);
  });

  test('7.3 6 cartas: não é canastra, bater não deve ser auto', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const seis = group7('K').slice(0, 6); // 6 cartas
    const junk = [card('3','♠'), card('4','♠')]; // 2 cartas sobrando (regra mão mínima)
    g.hands[0] = [...seis, ...junk];
    fakeDraw(g, 0);
    const res = playNew(g, 0, seis);
    assert.ok(res.ok);
    assert.ok(!res.autoBater, '6 cartas não é canastra, não deve bater automaticamente');
  });

  test('7.4 Canastra suja bônus = +100 pts no total', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const canasta = [
      card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
      card('K','♠',2), card('K','♥',2), card('2','♣',1),
    ];
    g.hands[0] = canasta;
    fakeDraw(g, 0);
    const res = playNew(g, 0, canasta);
    assert.ok(res.autoBater);
    assert.equal(res.teamMeldDetails[0].canastrasBonus, 100);
  });

  test('7.5 Canastra limpa bônus = +200 pts no total', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const canasta = group7('K');
    g.hands[0] = canasta;
    fakeDraw(g, 0);
    const res = playNew(g, 0, canasta);
    assert.ok(res.autoBater);
    assert.equal(res.teamMeldDetails[0].canastrasBonus, 200);
  });

});

// ─── 8. Regra da mão mínima ───────────────────────────────────────────────────

describe('Regra da mão mínima', () => {

  test('8.1 Baixar ficando com 1 carta sem canastra: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const trinca = [card('K','♠'), card('K','♥'), card('K','♦')];
    const junk   = card('3','♠'); // sobraria 1 carta — sem canastra: recusa
    g.hands[0] = [...trinca, junk];
    const res = playNew(g, 0, trinca);
    assert.ok(!res.ok);
    assert.match(res.msg, /2 cartas/i);
  });

  test('8.2 Baixar ficando com 0 cartas sem canastra: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const trinca = [card('K','♠'), card('K','♥'), card('K','♦')];
    g.hands[0] = trinca;
    const res = playNew(g, 0, trinca);
    assert.ok(!res.ok);
  });

  test('8.3 Baixar ficando com 0 cartas COM canastra: auto-bater', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    fakeDraw(g, 0);
    const canasta = group7('K');
    g.hands[0] = canasta;
    const res = playNew(g, 0, canasta);
    assert.ok(res.ok && res.autoBater);
  });

  test('8.4 Descartar última carta sem canastra: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const trinca = [card('K','♠'), card('K','♥'), card('K','♦')];
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: trinca }]; // sem canastra
    const junk = card('3','♠');
    g.hands[0] = [junk];
    fakeDraw(g, 0);
    const res = g.discard_(0, junk.id);
    assert.ok(!res.ok);
    assert.match(res.msg, /canastra/i);
  });

});

// ─── 9. Bater ────────────────────────────────────────────────────────────────

describe('Bater', () => {

  test('9.1 Bater sem canastra: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠'), card('K','♥'), card('K','♦')] }]; // só 3 cartas, não é canastra
    g.hands[0] = [card('3','♠')];
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /canastra/i);
  });

  test('9.2 Bater sem ter comprado: recusado', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    const res = g.bater(0);
    assert.ok(!res.ok);
    assert.match(res.msg, /comprar/i);
  });

  test('9.3 Bater com canastra na mesa: ok', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠'), card('4','♠')];
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(res.ok);
  });

  test('9.4 Bônus batida normal = 50 pts', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠')];
    g.hasPlayedMelds[0] = true; // já baixou antes
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(res.ok);
    assert.equal(res.teamMeldDetails[0].baterBonus, 50);
  });

  test('9.5 Bônus batida limpa = 100 pts (nunca baixou antes)', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠')];
    // hasPlayedMelds[0] = false (padrão)
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true
    const res = g.bater(0, card('3','♠').id);
    assert.ok(res.ok);
    assert.equal(res.teamMeldDetails[0].baterBonus, 100);
  });

  test('9.6 Dupla adversária não recebe bônus de batida', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠')];
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(res.ok);
    assert.equal(res.teamMeldDetails[1].baterBonus, 0);
  });

  test('9.7 Perda de mão: todos que não bateram perdem pontos das cartas na mão', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠')];
    const junkForOthers = [card('A','♠'), card('A','♥')]; // 30 pts
    g.hands[1] = [...junkForOthers];
    g.hands[2] = [...junkForOthers];
    g.hands[3] = [...junkForOthers];
    fakeDraw(g, 0);
    const res = g.bater(0);
    // Jogadores 1 e 3 (dupla 1) devem ter perdido pontos de mão
    const loser1 = res.playerHandLoss.find(p => p.teamIndex === 1);
    assert.ok(loser1.handPoints > 0, 'Dupla adversária deve perder pontos de mão');
    // Parceiro (jogador 2, dupla 0) também perde mão
    const partner = res.playerHandLoss.find((p, i) => i === 2);
    assert.ok(partner.handPoints > 0, 'Parceiro também perde pontos de mão');
    // Quem bateu não perde mão
    const batter = res.playerHandLoss.find(p => p.isBatter);
    assert.equal(batter.handPoints, 0, 'Quem bateu não perde mão');
  });

});

// ─── 10. Primeira baixa / Buraco ─────────────────────────────────────────────

describe('Primeira baixa e regra do buraco', () => {

  test('10.1 Fora do buraco: qualquer trinca é válida como primeira baixa', () => {
    const g = setupGame();
    g.scores[0] = 500; // < 1000
    fakeDraw(g, 0);
    const t = [card('3','♠'), card('3','♥'), card('3','♦')];
    g.hands[0] = [...t, card('4','♠'), card('5','♠')];
    const res = playNew(g, 0, t);
    assert.ok(res.ok);
    assert.ok(g.hasFirstMeld[0]);
  });

  test('10.2 No buraco: trinca de 3s (15 pts) recusada como primeira baixa', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    fakeDraw(g, 0);
    const t = [card('3','♠'), card('3','♥'), card('3','♦')];
    g.hands[0] = [...t, card('4','♠'), card('5','♠')];
    const res = playNew(g, 0, t);
    assert.ok(!res.ok);
    assert.match(res.msg, /100/);
  });

  test('10.3 No buraco: 4As + 4Ks = 100 pts aceita como primeira baixa', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    fakeDraw(g, 0);
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)];
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)];
    const junk  = [card('3','♠'), card('4','♠')];
    g.hands[0] = [...aces, ...kings, ...junk];
    const res = g.playMelds(0, [
      { type: 'new', cards: aces.map(c => c.id) },
      { type: 'new', cards: kings.map(c => c.id) },
    ]);
    assert.ok(res.ok);
    assert.ok(g.hasFirstMeld[0]);
  });

  test('10.4 Após primeira baixa, hasFirstMeld permanece true nas próximas rodadas', () => {
    const g = setupGame();
    fakeDraw(g, 0);
    const t = [card('K','♠'), card('K','♥'), card('K','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    playNew(g, 0, t);
    assert.ok(g.hasFirstMeld[0]);
    // Na próxima rodada, hasFirstMeld é resetado
    g.startRound();
    assert.ok(!g.hasFirstMeld[0], 'hasFirstMeld deve resetar a cada rodada');
  });

  test('10.5 Parceiro pode adicionar cartas à mesa após primeiro baixou', () => {
    const g = setupGame();
    // Jogador 0 (dupla 0) já abriu
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1)] }];
    // Agora é a vez do jogador 2 (parceiro, dupla 0)
    g.currentPlayerIndex = 2;
    fakeDraw(g, 2);
    const addCard = card('K','♣',1);
    g.hands[2] = [addCard, card('3','♠'), card('4','♠')];
    const res = g.playMelds(2, [{ type: 'add', meldIndex: 0, cards: [addCard.id] }]);
    assert.ok(res.ok);
    assert.equal(g.melds[0][0].cards.length, 4);
  });

});

// ─── 11. Staging (buraco — em espera) ────────────────────────────────────────

describe('Staging no buraco', () => {

  test('11.1 stageMeld remove cartas da mão imediatamente', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const t = [card('K','♠'), card('K','♥'), card('K','♦')];
    const junk = [card('3','♠'), card('4','♠')];
    g.hands[0] = [...t, ...junk];
    fakeDraw(g, 0);
    assert.ok(g.stageMeld(0, t.map(c => c.id)).ok);
    assert.equal(g.hands[0].length, 2);
  });

  test('11.2 Confirmação com < 100 pts: penalidade + cartas voltam', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const t = [card('3','♠'), card('3','♥'), card('3','♦')]; // 15 pts
    const junk = [card('4','♠'), card('5','♠')];
    g.hands[0] = [...t, ...junk];
    fakeDraw(g, 0);
    g.stageMeld(0, t.map(c => c.id));
    const res = g.confirmStagedMelds(0);
    assert.ok(!res.ok);
    assert.ok(res.penalized);
    assert.equal(g.firstMeldPenalty[0], true);
    assert.equal(g.hands[0].length, 5);
    assert.equal(g.melds[0].length, 0);
  });

  test('11.3 Após penalidade, threshold sobe para 150 pts', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    g.firstMeldPenalty[0] = true;
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)]; // 60
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)]; // 40
    const junk  = [card('3','♠'), card('4','♠')];
    g.hands[0] = [...aces, ...kings, ...junk];
    fakeDraw(g, 0);
    g.stageMeld(0, aces.map(c => c.id));
    g.stageMeld(0, kings.map(c => c.id));
    const res = g.confirmStagedMelds(0); // 100 pts, mas precisa 150
    assert.ok(!res.ok);
    assert.equal(res.penalized, false, 'Não deve penalizar duas vezes');
  });

  test('11.4 Confirmação com ≥ 100 pts: melds comprometidos', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)];
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)];
    g.hands[0] = [...aces, ...kings, card('3','♠'), card('4','♠')];
    fakeDraw(g, 0);
    g.stageMeld(0, aces.map(c => c.id));
    g.stageMeld(0, kings.map(c => c.id));
    const res = g.confirmStagedMelds(0);
    assert.ok(res.ok);
    assert.ok(g.hasFirstMeld[0]);
    assert.equal(g.melds[0].length, 2);
  });

  test('11.5 addToStagedMeld adiciona cartas ao meld em espera', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const t = [card('K','♠',1), card('K','♥',1), card('K','♦',1)];
    const extra = card('K','♣',1);
    const junk  = [card('3','♠'), card('4','♠')];
    g.hands[0] = [...t, extra, ...junk];
    fakeDraw(g, 0);
    g.stageMeld(0, t.map(c => c.id));
    const res = g.addToStagedMeld(0, 0, [extra.id]);
    assert.ok(res.ok);
    assert.equal(g.stagedMelds[0][0].cards.length, 4);
    assert.equal(g.hands[0].length, 2);
  });

  test('11.6 addToStagedMeld com tipo incompatível: recusado', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const t = [card('K','♠',1), card('K','♥',1), card('K','♦',1)]; // grupo
    const incompatible = card('Q','♣',1); // rank diferente
    g.hands[0] = [...t, incompatible, card('3','♠'), card('4','♠')];
    fakeDraw(g, 0);
    g.stageMeld(0, t.map(c => c.id));
    const res = g.addToStagedMeld(0, 0, [incompatible.id]);
    assert.ok(!res.ok);
  });

});

// ─── 12. Fim de jogo ──────────────────────────────────────────────────────────

describe('Fim de jogo', () => {

  test('12.1 Pontuação aumenta corretamente após rodada', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    const canasta = group7('K'); // 7×10 + 200 = 270 pts de cartas+bônus
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: canasta }];
    g.hands[0] = [card('3','♠')];
    // Outros jogadores com cartas na mão (perdem pontos)
    g.hands[1] = [card('A','♠')]; // -15
    g.hands[2] = [card('A','♥')]; // -15
    g.hands[3] = [card('A','♦')]; // -15
    fakeDraw(g, 0);
    g.hasPlayedMelds[0] = true;
    const res = g.bater(0);
    assert.ok(res.ok);
    // Dupla 0: 270 (mesa) + 50 (bater) - 15 (parceiro) = 305
    assert.equal(res.roundPoints[0], 270 + 50 - 15);
    assert.equal(g.scores[0], 305);
  });

  test('12.2 Jogo termina quando dupla atinge 2000 pts', () => {
    const g = setupGame();
    g.scores[0] = 1990;
    g.hasFirstMeld[0] = true;
    const canasta = group7('K');
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: canasta }];
    g.hands[0] = [card('3','♠')];
    g.hands[1] = []; g.hands[2] = []; g.hands[3] = [];
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(res.gameOver);
    assert.equal(res.winnerTeam, 0);
    assert.equal(g.status, 'finished');
  });

  test('12.3 Jogo não termina com < 2000 pts', () => {
    const g = setupGame();
    g.scores[0] = 100;
    g.hasFirstMeld[0] = true;
    const canasta = group7('3'); // 7×5 + 200 = 235
    g.melds[0] = [{ rank: '3', suit: '♠', type: 'group', cards: canasta }];
    g.hands[0] = [card('4','♠')];
    g.hands[1] = []; g.hands[2] = []; g.hands[3] = [];
    fakeDraw(g, 0);
    const res = g.bater(0);
    assert.ok(!res.gameOver);
    assert.equal(g.status, 'roundOver');
  });

  test('12.4 status = roundOver enquanto espera o líder continuar', () => {
    const g = setupGame();
    g.hasFirstMeld[0] = true;
    g.melds[0] = [{ rank: 'K', suit: '♠', type: 'group', cards: group7('K') }];
    g.hands[0] = [card('3','♠')];
    g.hands[1] = []; g.hands[2] = []; g.hands[3] = [];
    fakeDraw(g, 0);
    g.bater(0);
    assert.equal(g.status, 'roundOver');
  });

});

// ─── 13. getStateFor ──────────────────────────────────────────────────────────

describe('getStateFor — visibilidade do estado', () => {

  test('13.1 Jogador vê apenas sua própria mão', () => {
    const g = setupGame();
    const s0 = g.getStateFor(0);
    const s1 = g.getStateFor(1);
    assert.deepEqual(s0.myHand, g.hands[0]);
    assert.deepEqual(s1.myHand, g.hands[1]);
    assert.notDeepEqual(s0.myHand, s1.myHand);
  });

  test('13.2 myTeam retorna o time correto', () => {
    const g = setupGame();
    assert.equal(g.getStateFor(0).myTeam, 0);
    assert.equal(g.getStateFor(1).myTeam, 1);
    assert.equal(g.getStateFor(2).myTeam, 0);
    assert.equal(g.getStateFor(3).myTeam, 1);
  });

  test('13.3 handSizes esconde o conteúdo das mãos alheias', () => {
    const g = setupGame();
    const s0 = g.getStateFor(0);
    assert.equal(s0.handSizes.length, 4);
    s0.handSizes.forEach((size, i) => {
      assert.equal(size, g.hands[i].length);
    });
  });

  test('13.4 stagedMelds e firstMeldPenalty são visíveis a todos', () => {
    const g = setupGame();
    g.scores[0] = 1000;
    const t = [card('K','♠'), card('K','♥'), card('K','♦')];
    g.hands[0] = [...t, card('3','♠'), card('4','♠')];
    fakeDraw(g, 0);
    g.stageMeld(0, t.map(c => c.id));
    g.firstMeldPenalty[0] = true;
    const s1 = g.getStateFor(1);
    assert.equal(s1.stagedMelds[0].length, 1);
    assert.equal(s1.firstMeldPenalty[0], true);
  });

});
