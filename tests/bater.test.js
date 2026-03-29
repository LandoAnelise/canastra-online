'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/GameEngine.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function card(rank, suit, n = 1) {
  return { id: `${rank}${suit}-${n}`, rank, suit };
}

/** Cria jogo com 4 jogadores e duplas já formadas. */
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

/**
 * Simula compra sem tirar carta do baralho:
 * marca o estado interno como se o jogador já tivesse comprado neste turno.
 */
function fakeDraw(g, playerIndex) {
  g.drawnThisTurn = true;
  g._turnStartedNeverPlayed = !g.hasPlayedMelds[playerIndex];
}

/**
 * Avança o turno de jogadores intermediários (draw + descartar a primeira carta).
 * Usado para simular rodadas entre dois turnos do jogador 0.
 */
function advanceOtherPlayers(g, from, to) {
  for (let p = from; p <= to; p++) {
    g.currentPlayerIndex = p;
    g.drawnThisTurn = false;
    const draw = g.drawFromDeck(p);
    assert.ok(draw.ok, `Bot ${p} falhou ao comprar: ${draw.msg}`);
    const cardToDiscard = g.hands[p][0];
    const dis = g.discard_(p, cardToDiscard.id);
    // Aceita ok ou autoBater (caso raro de baralho vazio)
    assert.ok(dis.ok || dis.autoBater || dis.deckEndRound, `Bot ${p} falhou ao descartar: ${dis.msg}`);
  }
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('Batida de 100 pontos (batida limpa)', () => {

  test('1. Baixou todas as cartas via playMelds (nunca baixou antes) → bônus 100', () => {
    const g = setupGame();

    // 7 Ks formam uma canastra limpa (grupo)
    const hand = [
      card('K', '♠', 1), card('K', '♥', 1), card('K', '♦', 1), card('K', '♣', 1),
      card('K', '♠', 2), card('K', '♥', 2), card('K', '♦', 2),
    ];
    g.hands[0] = hand;
    fakeDraw(g, 0); // primeira vez baixando → _turnStartedNeverPlayed = true

    const result = g.playMelds(0, [{ type: 'new', cards: hand.map(c => c.id) }]);

    assert.ok(result.ok, `playMelds falhou: ${result.msg}`);
    assert.ok(result.autoBater, 'Esperado autoBater = true');
    assert.equal(result.teamMeldDetails[0].baterBonus, 100,
      `Bônus esperado: 100, recebido: ${result.teamMeldDetails[0].baterBonus}`);
  });

  test('2. Baixou melds + descartou última carta (nunca baixou antes) → bônus 100', () => {
    const g = setupGame();

    // 7 Ks (canastra) + 3 Qs (trinca) + 1 carta lixo
    const kings  = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
                    card('K','♠',2), card('K','♥',2), card('K','♦',2)];
    const queens = [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1)];
    const junk   = card('3', '♠', 1);
    g.hands[0] = [...kings, ...queens, junk];
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true

    const playResult = g.playMelds(0, [
      { type: 'new', cards: kings.map(c => c.id) },
      { type: 'new', cards: queens.map(c => c.id) },
    ]);
    assert.ok(playResult.ok, `playMelds falhou: ${playResult.msg}`);
    assert.ok(!playResult.autoBater, 'Não deveria bater ainda (ainda tem 1 carta)');

    const disResult = g.discard_(0, junk.id);
    assert.ok(disResult.autoBater, 'Esperado autoBater ao descartar última carta');
    assert.equal(disResult.teamMeldDetails[0].baterBonus, 100,
      `Bônus esperado: 100, recebido: ${disResult.teamMeldDetails[0].baterBonus}`);
  });

});

describe('Batida normal (50 pontos) — jogador já havia baixado antes', () => {

  test('3. Baixou em turno anterior, depois baixou tudo via playMelds → bônus 50', () => {
    const g = setupGame();

    // Turno 1 do jogador 0: abre trinca de Qs, guarda 2 cartas (regra: mínimo 2 sem canastra)
    const queens = [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1)];
    const junk1  = card('3', '♠', 1);
    const junk2  = card('4', '♠', 1);
    g.hands[0] = [...queens, junk1, junk2]; // 5 cartas → após baixar 3Q, ficam 2
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true (ainda não baixou)

    const play1 = g.playMelds(0, [{ type: 'new', cards: queens.map(c => c.id) }]);
    assert.ok(play1.ok, `playMelds turno 1 falhou: ${play1.msg}`);
    // hasPlayedMelds[0] agora é true

    const dis1 = g.discard_(0, junk1.id);
    assert.ok(dis1.ok, `discard turno 1 falhou: ${dis1.msg}`);

    // Avança jogadores 1, 2, 3
    advanceOtherPlayers(g, 1, 3);

    // Turno 2 do jogador 0: baixa 7 Ks (canastra) e bate
    g.currentPlayerIndex = 0;
    g.drawnThisTurn = false;

    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
                   card('K','♠',2), card('K','♥',2), card('K','♦',2)];
    g.hands[0] = kings;
    fakeDraw(g, 0); // _turnStartedNeverPlayed = !hasPlayedMelds[0] = false

    const play2 = g.playMelds(0, [{ type: 'new', cards: kings.map(c => c.id) }]);
    assert.ok(play2.ok, `playMelds turno 2 falhou: ${play2.msg}`);
    assert.ok(play2.autoBater, 'Esperado autoBater = true');
    assert.equal(play2.teamMeldDetails[0].baterBonus, 50,
      `Bônus esperado: 50, recebido: ${play2.teamMeldDetails[0].baterBonus}`);
  });

  test('4. Baixou em turno anterior, depois descartou última carta → bônus 50', () => {
    const g = setupGame();

    // Turno 1: jogador 0 abre trinca de Qs, guarda 2 cartas (mínimo sem canastra)
    const queens = [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1)];
    const junk1  = card('3', '♠', 1);
    const junk2  = card('4', '♠', 1);
    g.hands[0] = [...queens, junk1, junk2];
    fakeDraw(g, 0);

    assert.ok(g.playMelds(0, [{ type: 'new', cards: queens.map(c => c.id) }]).ok);
    assert.ok(g.discard_(0, junk1.id).ok);

    advanceOtherPlayers(g, 1, 3);

    // Turno 2: baixa 7 Ks + 3 Js + descarta última
    g.currentPlayerIndex = 0;
    g.drawnThisTurn = false;

    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
                   card('K','♠',2), card('K','♥',2), card('K','♦',2)];
    const jacks = [card('J','♠',1), card('J','♥',1), card('J','♦',1)];
    const lastCard = card('5', '♠', 1);
    g.hands[0] = [...kings, ...jacks, lastCard];
    fakeDraw(g, 0); // _turnStartedNeverPlayed = false

    assert.ok(g.playMelds(0, [
      { type: 'new', cards: kings.map(c => c.id) },
      { type: 'new', cards: jacks.map(c => c.id) },
    ]).ok);

    const disResult = g.discard_(0, lastCard.id);
    assert.ok(disResult.autoBater, 'Esperado autoBater ao descartar');
    assert.equal(disResult.teamMeldDetails[0].baterBonus, 50,
      `Bônus esperado: 50, recebido: ${disResult.teamMeldDetails[0].baterBonus}`);
  });

});

describe('Cenário do buraco: dois playMelds no mesmo turno', () => {

  test('7. Buraco: primeiro playMelds (100 pts) + segundo playMelds (canastra, bate) → bônus 100', () => {
    const g = setupGame();
    g.scores[0] = 1050; // equipe 0 está no buraco

    // Dupla 0 ainda não abriu essa rodada (hasFirstMeld[0] = false)
    // Jogador 0 nunca baixou nessa rodada (hasPlayedMelds[0] = false)

    // Mão: 4 As + 4 Ks (4*15 + 4*10 = 100 pts, satisfaz buraco) + 7 Qs (canastra para bater)
    const aces  = [card('A','♠',1), card('A','♥',1), card('A','♦',1), card('A','♣',1)];
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1)];
    const queens = [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1), card('Q','♣',1),
                    card('Q','♠',2), card('Q','♥',2), card('Q','♦',2)];
    g.hands[0] = [...aces, ...kings, ...queens];
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true

    // Primeiro confirmar baixa: 4As + 4Ks = 100 pts (mínimo do buraco)
    const play1 = g.playMelds(0, [
      { type: 'new', cards: aces.map(c => c.id) },
      { type: 'new', cards: kings.map(c => c.id) },
    ]);
    assert.ok(play1.ok, `1º playMelds falhou: ${play1.msg}`);
    assert.ok(!play1.autoBater, 'Não deveria bater ainda (ainda tem 7 Qs na mão)');

    // Segundo confirmar baixa: 7 Qs (canastra) → auto-bat
    const play2 = g.playMelds(0, [{ type: 'new', cards: queens.map(c => c.id) }]);
    assert.ok(play2.ok, `2º playMelds falhou: ${play2.msg}`);
    assert.ok(play2.autoBater, 'Esperado autoBater no 2º playMelds');
    assert.equal(play2.teamMeldDetails[0].baterBonus, 100,
      `Bônus esperado: 100, recebido: ${play2.teamMeldDetails[0].baterBonus}`);
  });

});

describe('bater() com descarte da última carta (botão Bater!)', () => {

  test('8. Nunca baixou, usa bater() descartando última carta → bônus 100', () => {
    const g = setupGame();

    // 7 Ks na mesa (canastra da dupla já existente) + 1 junk na mão
    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    const junk = card('3', '♠', 1);
    g.hands[0] = [junk];
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true (nunca baixou)

    // Chama bater() descartando a última carta (simula clique no botão "Bater!")
    const result = g.bater(0, junk.id);
    assert.ok(result.ok, result.msg);
    assert.equal(result.teamMeldDetails[0].baterBonus, 100,
      `Bônus esperado: 100, recebido: ${result.teamMeldDetails[0].baterBonus}`);
  });

  test('9. Já havia baixado antes, usa bater() descartando última carta → bônus 50', () => {
    const g = setupGame();

    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    const junk = card('3', '♠', 1);
    g.hands[0] = [junk];
    g.hasPlayedMelds[0] = true; // já havia baixado em turno anterior
    fakeDraw(g, 0); // _turnStartedNeverPlayed = false

    const result = g.bater(0, junk.id);
    assert.ok(result.ok, result.msg);
    assert.equal(result.teamMeldDetails[0].baterBonus, 50,
      `Bônus esperado: 50, recebido: ${result.teamMeldDetails[0].baterBonus}`);
  });

});

describe('Casos limite', () => {

  test('5. Parceiro já havia baixado, mas o bater é do jogador que nunca baixou → bônus 100', () => {
    const g = setupGame();

    // Jogador 2 (também da dupla 0) já abriu melds numa rodada anterior
    // Simulamos isso diretamente: hasFirstMeld[0] = true, melds da dupla já tem algo
    // Mas hasPlayedMelds[0] ainda é false (o jogador 0 nunca jogou)
    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'Q', suit: '♠', type: 'group',
      cards: [card('Q','♠',1), card('Q','♥',1), card('Q','♦',1)],
    });

    // Jogador 0 baixa 7 Ks e bate pela primeira vez
    const kings = [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
                   card('K','♠',2), card('K','♥',2), card('K','♦',2)];
    g.hands[0] = kings;
    fakeDraw(g, 0); // _turnStartedNeverPlayed = true (ele nunca baixou)

    const result = g.playMelds(0, [{ type: 'new', cards: kings.map(c => c.id) }]);
    assert.ok(result.ok, result.msg);
    assert.ok(result.autoBater);
    assert.equal(result.teamMeldDetails[0].baterBonus, 100,
      'Jogador que nunca baixou deve ter bônus 100 mesmo que o parceiro já tenha baixado');
  });

  test('6. Bater manual (bater() com cartas na mão) → sempre bônus 50', () => {
    const g = setupGame();

    // Configura canastra da dupla 0 já na mesa
    g.hasFirstMeld[0] = true;
    g.melds[0].push({
      rank: 'K', suit: '♠', type: 'group',
      cards: [card('K','♠',1), card('K','♥',1), card('K','♦',1), card('K','♣',1),
              card('K','♠',2), card('K','♥',2), card('K','♦',2)],
    });

    // Jogador 0 tem 1 carta na mão e chama bater() manualmente (sem jogar nada)
    const remaining = card('3', '♠', 1);
    g.hands[0] = [remaining];
    fakeDraw(g, 0);

    const result = g.bater(0);
    assert.ok(result.ok, result.msg);
    assert.equal(result.teamMeldDetails[0].baterBonus, 50,
      'Bater manual sempre vale 50');
  });

});
