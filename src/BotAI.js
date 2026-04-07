'use strict';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const RANK_VAL = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};

const CARD_PTS = {
  'A': 15, '2': 10,
  'K': 10, 'Q': 10, 'J': 10, '10': 10, '9': 10, '8': 10, '7': 10,
  '6': 5, '5': 5, '4': 5, '3': 5,
};

const CLEAN_CANASTA_BONUS = 200;
const DIRTY_CANASTA_BONUS = 100;
const FIRST_MELD_THRESHOLD = 1000;

// Ranks cujos grupos têm baixa prioridade: essas cartas são mais valiosas em sequências
// e devem ser agrupadas apenas como último recurso (ex: buraco precisando de pontos).
const LOW_PRIORITY_GROUP_RANKS = new Set(['5', '6', '7', '8', '9', '10']);

// Tempo de espera por dificuldade (ms): simula tempo de pensar
const DELAYS = {
  easy:   { base: 800,  jitter: 400 },
  medium: { base: 1300, jitter: 600 },
  hard:   { base: 1100, jitter: 500 },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function cardPts(rank) { return CARD_PTS[rank] || 5; }
function isWild(card)  { return card.rank === '2'; }

/**
 * Retorna true se uma carta de valor numérico `v` e naipe `suit` pode ser
 * adicionada a uma sequência cujas cartas naturais são `meldNaturals`.
 *
 * Cobre três casos:
 *  1. Borda simples: v === min-1 ou v === max+1
 *  2. Lacuna interna: min < v < max e não está nos naturais (wild atua como gap)
 *  3. Borda estendida: coringas na borda permitem adicionar além de min-1 / max+1
 *     Ex: [5,6,7,wild(8)] → 9♥ é válido pois wild passa a ser gap interno em 8
 *
 * @param {number}   wildCount  número de coringas no meld (necessário para caso 3)
 */
function cardFitsSequence(v, suit, meldNaturals, wildCount = 0) {
  if (!meldNaturals.length || meldNaturals[0].suit !== suit) return false;
  const vs  = meldNaturals.map(c => cardNumVal(c)).sort((a, b) => a - b);
  const min = vs[0], max = vs[vs.length - 1];
  const naturalVals = new Set(vs);

  // Caso 2: lacuna interna
  if (v > min && v < max && !naturalVals.has(v)) return true;

  // Quantidade de coringas que sobram após preencher lacunas internas
  const internalGaps  = (max - min) - (vs.length - 1);
  const borderWilds   = Math.max(0, wildCount - internalGaps);

  // Caso 1+3: extensão de borda — até (borderWilds + 1) posições além de cada extremo
  if (v < min && v >= min - borderWilds - 1) return true;
  if (v > max && v <= max + borderWilds + 1) return true;

  return false;
}

/** Valor numérico do rank para ordenação em sequências (ás = 1). */
function cardNumVal(card) {
  if (card.rank === 'A') return 1;
  return RANK_VAL[card.rank] || 0;
}

function meldBasePoints(cards) {
  return cards.reduce((s, c) => s + cardPts(c.rank), 0);
}

/**
 * Pontos de um conjunto de cartas incluindo bônus de canastra.
 * Usa contagem simplificada de coringas (suficiente para decisões do bot).
 */
function meldPtsWithBonus(cards) {
  let pts = meldBasePoints(cards);
  if (cards.length >= 7) {
    const wilds = cards.filter(c => isWild(c)).length;
    pts += wilds === 0 ? CLEAN_CANASTA_BONUS : DIRTY_CANASTA_BONUS;
  }
  return pts;
}

function teamHasCanastra(game, teamIndex) {
  return game.melds[teamIndex].some(m => m.cards.length >= 7);
}

/**
 * Retorna o mínimo de pontos necessários para a primeira baixa.
 * 0 = já baixou ou não está no buraco.
 */
function requiredFirstMeldPts(game, teamIndex) {
  if (game.hasFirstMeld[teamIndex]) return 0;
  if (game.scores[teamIndex] < FIRST_MELD_THRESHOLD) return 0;
  return game.firstMeldPenalty[teamIndex] ? 150 : 100;
}

function randomDelay(difficulty) {
  const { base, jitter } = DELAYS[difficulty] || DELAYS.medium;
  return base + Math.floor(Math.random() * jitter);
}

// ─── ENCONTRAR CANDIDATOS A MELD ──────────────────────────────────────────────

/**
 * Encontra possíveis grupos (3+ do mesmo rank) na mão do bot.
 * Dificuldade 'easy': apenas grupos puros sem coringas.
 * Dificuldades 'medium'/'hard': também grupos com 1-2 coringas.
 */
/**
 * @param {boolean} allowWildsInGroups - Permite criar novos grupos mistos com coringa.
 *   Deve ser true apenas no buraco (primeira baixa precisa de pontos) ou para bater.
 *   Em jogo normal, bots nunca criam grupos novos com coringa.
 */
function findGroupCandidates(hand, difficulty, allowWildsInGroups = false) {
  const naturals = hand.filter(c => !isWild(c));
  const wilds    = hand.filter(c => isWild(c));

  const byRank = {};
  for (const card of naturals) {
    (byRank[card.rank] = byRank[card.rank] || []).push(card);
  }

  const candidates = [];

  for (const [rank, cards] of Object.entries(byRank)) {
    if (rank === '2') continue;

    const isLowPriority = LOW_PRIORITY_GROUP_RANKS.has(rank);

    if (cards.length >= 3) {
      candidates.push({
        cardIds:     cards.map(c => c.id),
        pts:         meldPtsWithBonus(cards),
        isCanastra:  cards.length >= 7,
        lowPriority: isLowPriority,
      });
    } else if (allowWildsInGroups && difficulty !== 'easy') {
      // Coringas em grupos novos apenas quando explicitamente permitido (buraco ou para bater)
      if (cards.length === 2 && wilds.length >= 1) {
        for (const wild of wilds) {
          const g = [...cards, wild];
          candidates.push({ cardIds: g.map(c => c.id), pts: meldPtsWithBonus(g), isCanastra: false, lowPriority: isLowPriority });
        }
      }
    }
  }

  // Grupo puro de 2s
  if (difficulty !== 'easy' && wilds.length >= 3) {
    const g = wilds.slice(0, Math.min(wilds.length, 7));
    candidates.push({ cardIds: g.map(c => c.id), pts: meldPtsWithBonus(g), isCanastra: g.length >= 7 });
  }

  return candidates;
}

/**
 * Encontra possíveis sequências (3+ consecutivas do mesmo naipe) na mão.
 * 'easy': nenhuma sequência.
 * 'medium'/'hard': sequências com 0 ou 1 coringa.
 */
function findSequenceCandidates(hand, difficulty) {
  if (difficulty === 'easy') return [];

  const naturals = hand.filter(c => !isWild(c));
  const wilds    = hand.filter(c => isWild(c));

  const bySuit = {};
  for (const card of naturals) {
    (bySuit[card.suit] = bySuit[card.suit] || []).push(card);
  }

  const candidates = [];
  const seen = new Set();

  for (const suitCards of Object.values(bySuit)) {
    // Ordena por valor numérico (ás baixo)
    const sorted = [...suitCards].sort((a, b) => cardNumVal(a) - cardNumVal(b));

    for (let i = 0; i < sorted.length; i++) {
      const seqNaturals = [sorted[i]];
      let wildsNeeded   = 0;

      for (let j = i + 1; j < sorted.length; j++) {
        const prevVal = cardNumVal(seqNaturals[seqNaturals.length - 1]);
        const currVal = cardNumVal(sorted[j]);
        const gap     = currVal - prevVal - 1;

        if (gap < 0)   break; // rank duplicado
        if (gap === 0) {
          seqNaturals.push(sorted[j]);
        } else if (gap === 1 && wildsNeeded === 0 && wilds.length >= 1) {
          wildsNeeded = 1;
          seqNaturals.push(sorted[j]);
        } else {
          break; // lacuna grande demais
        }

        if (seqNaturals.length + wildsNeeded >= 3) {
          const w   = wildsNeeded ? [wilds[0]] : [];
          const all = [...seqNaturals, ...w];
          const key = all.map(c => c.id).sort().join(',');
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({
              cardIds:    all.map(c => c.id),
              pts:        meldPtsWithBonus(all),
              isCanastra: all.length >= 7,
              isSequence: true,
            });
          }
        }
      }

      // Extensão de borda: usar 1 coringa para estender uma corrida de 2 naturais
      if (wildsNeeded === 0 && wilds.length >= 1 && seqNaturals.length === 2) {
        const first = cardNumVal(seqNaturals[0]);
        const last  = cardNumVal(seqNaturals[seqNaturals.length - 1]);
        if (first > 2 || last < 13) {
          const all = [...seqNaturals, wilds[0]];
          const key = all.map(c => c.id).sort().join(',');
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ cardIds: all.map(c => c.id), pts: meldPtsWithBonus(all), isCanastra: false, isSequence: true });
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Encontra cartas na mão que podem ser adicionadas aos melds existentes do time.
 * Retorna candidatos do tipo 'add'.
 */
function findExtensionCandidates(hand, teamMelds, difficulty) {
  const wilds      = hand.filter(c => isWild(c));
  const candidates = [];

  for (let meldIdx = 0; meldIdx < teamMelds.length; meldIdx++) {
    const meld = teamMelds[meldIdx];

    if (meld.type === 'group') {
      const meldRank = meld.cards.find(c => !isWild(c))?.rank || meld.cards[0]?.rank;
      if (!meldRank) continue;

      let matching;
      if (meldRank === '2') {
        matching = wilds;
      } else {
        matching = hand.filter(c => !isWild(c) && c.rank === meldRank);
      }

      if (matching.length > 0) {
        // Extensão natural: TODAS as dificuldades — cartas do mesmo rank sempre vão para o meld existente
        const extended = [...meld.cards, ...matching];
        candidates.push({
          meldIndex:       meldIdx,
          cardIds:         matching.map(c => c.id),
          pts:             meldPtsWithBonus(extended) - meldPtsWithBonus(meld.cards),
          resultsCanastra: extended.length >= 7 && meld.cards.length < 7,
          currentLen:      meld.cards.length,
        });
      } else if (difficulty !== 'easy' && meldRank !== '2' && wilds.length > 0 && meld.cards.length === 6) {
        // Extensão com coringa para completar canastra (grupo com 6 cartas): medium/hard
        const alreadyHasWild = meld.cards.some(c => isWild(c));
        if (!alreadyHasWild) {
          const extended = [...meld.cards, wilds[0]];
          candidates.push({
            meldIndex:       meldIdx,
            cardIds:         [wilds[0].id],
            pts:             meldPtsWithBonus(extended) - meldPtsWithBonus(meld.cards),
            resultsCanastra: true,
            currentLen:      meld.cards.length,
          });
        }
      }

    } else if (difficulty !== 'easy' && meld.type === 'sequence') {
      // Extensão de sequência: medium/hard
      const meldNaturals = meld.cards.filter(c => !isWild(c));
      if (!meldNaturals.length) continue;

      const meldSuit   = meldNaturals[0].suit;
      const sortedVals = meldNaturals.map(c => cardNumVal(c)).sort((a, b) => a - b);
      const minV = sortedVals[0];
      const maxV = sortedVals[sortedVals.length - 1];

      const meldWildCount = meld.cards.filter(c => isWild(c)).length;
      const extending = hand.filter(c => {
        if (isWild(c) || c.suit !== meldSuit) return false;
        return cardFitsSequence(cardNumVal(c), meldSuit, meldNaturals, meldWildCount);
      });

      if (extending.length > 0) {
        const extended = [...meld.cards, ...extending];
        candidates.push({
          meldIndex:       meldIdx,
          cardIds:         extending.map(c => c.id),
          pts:             meldPtsWithBonus(extended) - meldPtsWithBonus(meld.cards),
          resultsCanastra: extended.length >= 7 && meld.cards.length < 7,
          currentLen:      meld.cards.length,
        });
      }
    }
  }

  return candidates;
}

/**
 * Seleciona um conjunto não-conflitante de ações de meld maximizando o valor.
 * Prioridade: extensões que completam canastras > extensões simples > novos melds.
 */
function selectMeldActions(newCandidates, extCandidates, hand, hasCanastra) {
  const usedIds        = new Set();
  const meldActions    = [];
  let handSize         = hand.length;
  let hasCanastraAfter = hasCanastra;

  const all = [
    ...extCandidates.map(c => ({
      ...c,
      isExt: true,
      // Prioridade de extensão: completar canastra > perto de canastra > normal
      priority: c.resultsCanastra ? 2000
        : c.currentLen >= 5 ? 1500   // 1 ou 2 cartas para canastra
        : c.currentLen >= 4 ? 800    // 3 cartas para canastra
        : 200 + c.pts,
    })),
    ...newCandidates.map(c => ({
      ...c,
      isExt: false,
      // Canastas > sequências > grupos altos > grupos 5-10 (baixa prioridade)
      priority: c.isCanastra   ? 1800
        : c.lowPriority        ? -100
        : c.isSequence         ? c.pts + 50  // sequências têm prioridade sobre grupos
        : c.pts,
    })),
  ].sort((a, b) => b.priority - a.priority);

  for (const cand of all) {
    if (cand.cardIds.some(id => usedIds.has(id))) continue;

    const cost             = cand.cardIds.length;
    const remainingAfter   = handSize - cost;
    const wouldHaveCanastra = hasCanastraAfter || cand.isCanastra || cand.resultsCanastra;

    // Deve manter pelo menos 2 cartas (1 para descartar + 1 buffer) a menos que tenha canastra
    if (remainingAfter < 2 && !wouldHaveCanastra) continue;
    // Não pode ficar com 0 cartas sem canastra (seria auto-bater sem condições)
    if (remainingAfter < 0) continue;

    if (cand.isExt) {
      meldActions.push({ type: 'add', meldIndex: cand.meldIndex, cards: cand.cardIds });
    } else {
      meldActions.push({ type: 'new', cards: cand.cardIds });
    }

    cand.cardIds.forEach(id => usedIds.add(id));
    handSize -= cost;
    if (cand.isCanastra || cand.resultsCanastra) hasCanastraAfter = true;
  }

  return meldActions;
}

// ─── DECISÃO DE BAIXAR ────────────────────────────────────────────────────────

/**
 * Decide quais cartas baixar neste turno.
 * Retorna um array de meldActions compatíveis com game.playMelds().
 */
function decideMeldActions(game, botIdx, difficulty) {
  const hand      = game.hands[botIdx];
  const teamIndex = game.players[botIdx].teamIndex;
  const teamMelds = game.melds[teamIndex];
  const hasCan    = teamHasCanastra(game, teamIndex);
  const required  = requiredFirstMeldPts(game, teamIndex);

  const seqCands = findSequenceCandidates(hand, difficulty);
  const extCands = game.hasFirstMeld[teamIndex]
    ? findExtensionCandidates(hand, teamMelds, difficulty)
    : [];

  // ── Primeira baixa no buraco: permite coringas em grupos para atingir threshold ──
  if (required > 0) {
    const groupCands = findGroupCandidates(hand, difficulty, /* allowWildsInGroups */ true);
    const newCands   = [...groupCands, ...seqCands];
    const sorted = [...newCands].sort((a, b) => {
      if (a.lowPriority !== b.lowPriority) return a.lowPriority ? 1 : -1;
      return b.pts - a.pts;
    });
    const usedIds  = new Set();
    const actions  = [];
    let totalPts   = 0;
    let handSize   = hand.length;
    let canAfter   = hasCan;

    for (const cand of sorted) {
      if (cand.cardIds.some(id => usedIds.has(id))) continue;

      const remainingAfter    = handSize - cand.cardIds.length;
      const wouldHaveCanastra = canAfter || cand.isCanastra;
      if (remainingAfter < 2 && !wouldHaveCanastra) continue;

      actions.push({ type: 'new', cards: cand.cardIds });
      cand.cardIds.forEach(id => usedIds.add(id));
      handSize -= cand.cardIds.length;
      totalPts += cand.pts;
      if (cand.isCanastra) canAfter = true;

      if (totalPts >= required) return actions;
    }

    return []; // não consegue atingir o threshold — não baixa
  }

  // ── Baixa normal: sem coringas em grupos novos, sem grupos de ranks 5-10 ──
  // Grupos de ranks 5-10 só entram no buraco. Em jogo normal nenhum humano baixa "7,7,7".
  const groupCands = findGroupCandidates(hand, difficulty, /* allowWildsInGroups */ false)
    .filter(c => !c.lowPriority);
  const newCands   = [...groupCands, ...seqCands];
  const actions    = selectMeldActions(newCands, extCands, hand, hasCan);

  // ── Exceção: coringas em grupos (incl. ranks 5-10) se viabiliza bater ──
  // (time já tem canastra e usar esses grupos reduziria a mão a 1 carta)
  if (hasCan) {
    const usedNormal   = new Set(actions.flatMap(a => a.cards));
    const remNormal    = hand.filter(c => !usedNormal.has(c.id)).length;
    if (remNormal > 1) {
      const groupCandsW = findGroupCandidates(hand, difficulty, true); // inclui lowPriority + wilds
      const newCandsW   = [...groupCandsW, ...seqCands];
      const actionsW    = selectMeldActions(newCandsW, extCands, hand, hasCan);
      const usedWild    = new Set(actionsW.flatMap(a => a.cards));
      const remWild     = hand.filter(c => !usedWild.has(c.id)).length;
      if (remWild <= 1 && remWild < remNormal) return actionsW;
    }
  }

  return actions;
}

// ─── DECISÃO DE DESCARTAR ─────────────────────────────────────────────────────

/**
 * Pontua uma carta para descarte. Pontuação mais alta = mais descartável.
 */
function scoreForDiscard(card, hand, teamIndex, game, difficulty) {
  if (isWild(card)) return -1000; // nunca descartar coringa

  let score = 15 - cardPts(card.rank); // base: cartas de menor valor são mais descartáveis
  if (card.rank === 'A') score -= 5;   // ás tem valor alto, evitar descartar

  if (difficulty === 'easy') return score;

  const others    = hand.filter(c => c.id !== card.id);
  const teamMelds = game.melds[teamIndex];
  const oppMelds  = game.melds[1 - teamIndex];
  const v         = cardNumVal(card);

  // Penaliza se a carta faz parte de um grupo potencial na mão
  const sameRank = others.filter(c => c.rank === card.rank && !isWild(c)).length;
  if (sameRank >= 2) score -= 25;
  else if (sameRank >= 1) score -= 10;

  // Penaliza se a carta é adjacente a cartas do mesmo naipe (sequência potencial)
  const adjSuit = others.filter(c => c.suit === card.suit && !isWild(c) && Math.abs(cardNumVal(c) - v) <= 2).length;
  if (adjSuit >= 2) score -= 18;
  else if (adjSuit >= 1) score -= 7;

  // Penaliza se a carta pode estender um meld do próprio time
  for (const meld of teamMelds) {
    if (meld.cards.length >= 7) continue;
    if (meld.type === 'group') {
      const mr = meld.cards.find(c => !isWild(c))?.rank;
      if (mr && card.rank === mr) { score -= 15; break; }
    } else if (meld.type === 'sequence') {
      const mn = meld.cards.filter(c => !isWild(c));
      const mw = meld.cards.filter(c => isWild(c)).length;
      if (cardFitsSequence(v, card.suit, mn, mw)) { score -= 12; break; }
    }
  }

  if (difficulty !== 'hard') return score;

  // Hard: evita fortemente descartar cartas que estendem melds do adversário
  for (const meld of oppMelds) {
    if (meld.cards.length >= 7) continue; // canastra completa: não importa
    if (meld.type === 'group') {
      const mr = meld.cards.find(c => !isWild(c))?.rank;
      if (mr && card.rank === mr) { score -= 35; break; }
    } else if (meld.type === 'sequence') {
      const mn = meld.cards.filter(c => !isWild(c));
      const mw = meld.cards.filter(c => isWild(c)).length;
      if (cardFitsSequence(v, card.suit, mn, mw)) { score -= 30; break; }
    }
  }

  return score;
}

/** Escolhe a melhor carta para descartar. */
function chooseDiscard(game, botIdx, difficulty) {
  const hand      = game.hands[botIdx];
  const teamIndex = game.players[botIdx].teamIndex;
  const forbidden = game.tookSingleDiscardId;

  const candidates = hand.filter(c => c.id !== forbidden);
  if (candidates.length === 0) return hand[0]?.id;

  return candidates
    .slice()
    .sort((a, b) => scoreForDiscard(b, hand, teamIndex, game, difficulty)
                  - scoreForDiscard(a, hand, teamIndex, game, difficulty))
    [0].id;
}

// ─── DECISÃO DE PEGAR O LIXO ─────────────────────────────────────────────────

/** Decide se vale a pena pegar o lixo em vez de pescar do monte. */
function shouldTakeDiscard(game, botIdx, difficulty) {
  if (difficulty === 'easy') return false;

  const pile = game.discard;
  if (!pile.length) return false;

  const hand = game.hands[botIdx];
  // Regra: mão com 1 carta e lixo com 1 carta → obrigado a pescar
  if (hand.length === 1 && pile.length === 1) return false;

  const topCard   = pile[pile.length - 1];
  const teamIndex = game.players[botIdx].teamIndex;
  const teamMelds = game.melds[teamIndex];

  if (difficulty === 'medium') {
    // Pega se a carta do topo forma grupo de 3 com a mão
    const sameRank = hand.filter(c => c.rank === topCard.rank && !isWild(c)).length;
    if (sameRank >= 2) return true;
    if (sameRank >= 1 && hand.some(c => isWild(c))) return true;

    // Pega se a carta do topo estende um meld do time
    for (const meld of teamMelds) {
      if (meld.type === 'group') {
        const mr = meld.cards.find(c => !isWild(c))?.rank;
        if (mr && topCard.rank === mr) return true;
      } else if (meld.type === 'sequence') {
        const mn = meld.cards.filter(c => !isWild(c));
        const mw = meld.cards.filter(c => isWild(c)).length;
        if (cardFitsSequence(cardNumVal(topCard), topCard.suit, mn, mw)) return true;
      }
    }
    return false;
  }

  if (difficulty === 'hard') {
    // O lixo é aberto: avalia todas as cartas, não só o topo
    let value = 0;
    for (const dc of pile) {
      // Coringas são muito valiosos independentemente do contexto
      if (isWild(dc)) { value += 25; continue; }

      const v  = cardNumVal(dc);
      const sr = hand.filter(c => c.rank === dc.rank && !isWild(c)).length;

      // Forma grupo novo com cartas na mão
      if (sr >= 2) value += 20;
      else if (sr >= 1 && hand.some(c => isWild(c))) value += 12;
      else if (sr >= 1) value += 8;

      // Estende meld do time (grupo ou sequência, incluindo lacunas de coringa)
      for (const meld of teamMelds) {
        if (meld.cards.length >= 7) continue;
        if (meld.type === 'group') {
          const mr = meld.cards.find(c => !isWild(c))?.rank;
          if (mr && dc.rank === mr) { value += 15; break; }
        } else if (meld.type === 'sequence') {
          const mn = meld.cards.filter(c => !isWild(c));
          const mw = meld.cards.filter(c => isWild(c)).length;
          if (cardFitsSequence(v, dc.suit, mn, mw)) { value += 15; break; }
        }
      }

      // Valor base da carta
      value += cardPts(dc.rank) / 8;
    }

    // Threshold: ajustado para lixo inteiro (pile maior → mais chance de acumular valor)
    return value >= 20;
  }

  return false;
}

// ─── DECISÃO DE BATER ────────────────────────────────────────────────────────

/** Decide se o bot deve bater e com qual carta descartar (se houver). */
function decideBater(game, botIdx, difficulty) {
  const teamIndex = game.players[botIdx].teamIndex;
  const hand      = game.hands[botIdx];

  if (!teamHasCanastra(game, teamIndex)) return { bater: false };

  // Mão vazia: bater sem descartar (auto-bater pela meld fase já cobre, mas tratamos aqui também)
  if (hand.length === 0) return { bater: true, discardCardId: null };

  // Bater apenas quando resta 1 carta (descarta ela e fica com 0)
  // Isso garante batida limpa e evita bater com cartas sobrando na mão
  if (hand.length === 1) {
    return { bater: true, discardCardId: hand[0].id };
  }

  return { bater: false };
}

// ─── TURNO PRINCIPAL DO BOT ──────────────────────────────────────────────────

/**
 * Executa um turno completo de um bot:
 * 1. Pesca do monte ou pega o lixo
 * 2. Baixa cartas (se possível e vantajoso)
 * 3. Decide se bate
 * 4. Descarta
 */
async function executeBotTurn(game, botIdx, difficulty, rm, roomId) {
  if (game.status !== 'playing')          return;
  if (game.currentPlayerIndex !== botIdx) return;

  const d = difficulty || 'medium';

  // ── 1. Pesca / pega lixo ──
  await new Promise(r => setTimeout(r, randomDelay(d)));
  if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) return;

  let tookPile = false;
  if (shouldTakeDiscard(game, botIdx, d)) {
    const res = game.takeDiscard(botIdx);
    if (res.ok) {
      rm.broadcastToRoom(roomId, 'playerTookDiscard', {});
      rm.broadcastState(game);
      tookPile = true;
    }
  }

  if (!tookPile) {
    const res = game.drawFromDeck(botIdx);
    if (!res.ok) return;
    if (res.deckNowEmpty) {
      rm.broadcastToRoom(roomId, 'deckEmpty', { playerName: game.players[botIdx]?.name });
    }
    rm.broadcastToRoom(roomId, 'playerDrew', {});
    rm.broadcastState(game);
  }

  // ── 2. Baixa cartas ──
  await new Promise(r => setTimeout(r, Math.floor(randomDelay(d) * 0.5)));
  if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) return;

  const teamIndex   = game.players[botIdx].teamIndex;
  const isFirstMeld = !game.hasFirstMeld[teamIndex];
  const meldActions = decideMeldActions(game, botIdx, d);

  if (meldActions.length > 0) {
    if (isFirstMeld) {
      // Primeira baixa: submete tudo de uma vez (necessário para atingir o threshold no buraco)
      const res = game.playMelds(botIdx, meldActions);
      if (res.ok) {
        rm.broadcastToRoom(roomId, 'playerDealt', {});
        if (res.autoBater) {
          rm.broadcastToRoom(roomId, 'roundEnded', res);
          rm.broadcastState(game);
          return;
        }
        rm.broadcastState(game);
      }
    } else {
      // Baixas normais: uma por vez com 500 ms de intervalo para acompanhar visualmente
      for (const action of meldActions) {
        if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) break;
        await new Promise(r => setTimeout(r, 800));
        if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) break;

        const res = game.playMelds(botIdx, [action]);
        if (!res.ok) continue; // carta pode já ter sido usada numa baixa anterior
        rm.broadcastToRoom(roomId, 'playerDealt', {});
        if (res.autoBater) {
          rm.broadcastToRoom(roomId, 'roundEnded', res);
          rm.broadcastState(game);
          return;
        }
        rm.broadcastState(game);
      }
    }
  }

  // ── 3. Bate? ──
  await new Promise(r => setTimeout(r, Math.floor(randomDelay(d) * 0.3)));
  if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) return;

  const baterDec = decideBater(game, botIdx, d);
  if (baterDec.bater) {
    const res = game.bater(botIdx, baterDec.discardCardId);
    if (res.ok) {
      rm.broadcastToRoom(roomId, 'roundEnded', res);
      rm.broadcastState(game);
      return;
    }
  }

  // ── 4. Descarta ──
  await new Promise(r => setTimeout(r, Math.floor(randomDelay(d) * 0.3)));
  if (game.status !== 'playing' || game.currentPlayerIndex !== botIdx) return;

  const discardId  = chooseDiscard(game, botIdx, d);
  const discardRes = game.discard_(botIdx, discardId);

  if (!discardRes.ok) {
    // Fallback: descarta qualquer carta não proibida
    const fallback = game.hands[botIdx].find(c => c.id !== game.tookSingleDiscardId);
    if (fallback) game.discard_(botIdx, fallback.id);
  }

  if (discardRes.autoBater || discardRes.deckEndRound) {
    rm.broadcastToRoom(roomId, 'roundEnded', discardRes);
  }
  rm.broadcastState(game);
}

/**
 * Ponto de entrada principal: executa turnos dos bots enquanto for a vez deles.
 * Deve ser chamado após cada ação de um jogador humano e no início de cada rodada.
 *
 * @param {object} game       - Instância do jogo
 * @param {string} roomId     - ID da sala
 * @param {object} rm         - Room manager (broadcastState, broadcastToRoom)
 * @param {string} difficulty - 'easy' | 'medium' | 'hard' (padrão: game.botDifficulty ou 'medium')
 */
function runBotTurns(game, roomId, rm, difficulty) {
  if (game.status !== 'playing') return;
  if (!game.botSeats || !game.botSeats.has(game.currentPlayerIndex)) return;

  const botIdx = game.currentPlayerIndex;
  const d      = difficulty || game.botDifficulty || 'medium';

  executeBotTurn(game, botIdx, d, rm, roomId)
    .then(() => {
      // Encadeia próximo turno de bot se necessário
      if (game.status === 'playing' && game.botSeats.has(game.currentPlayerIndex)) {
        runBotTurns(game, roomId, rm, d);
      }
    })
    .catch(err => console.error(`[BotAI] Erro no turno do bot ${botIdx}:`, err));
}

module.exports = { runBotTurns, executeBotTurn };
