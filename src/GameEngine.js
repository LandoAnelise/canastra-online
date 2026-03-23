'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const CARD_POINTS = {
  'A': 15,
  '2': 10,
  'K': 10, 'Q': 10, 'J': 10, '10': 10, '9': 10, '8': 10, '7': 10,
  '6': 5, '5': 5, '4': 5, '3': 5,
};

const CLEAN_CANASTA_POINTS = 200;
const DIRTY_CANASTA_POINTS = 100;
const BATER_BONUS = 50;
const WIN_SCORE = 2000;
const FIRST_MELD_MIN_SCORE_THRESHOLD = 1000; // se tiver menos de 1000, pode baixar qualquer coisa

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function cardPoints(rank) {
  return CARD_POINTS[rank] || 5;
}

function isWild(card) {
  return card.rank === '2';
}

function createDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit, id: `${rank}${suit}_${d}` });
      }
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── MELD VALIDATION ─────────────────────────────────────────────────────────
// Ás pode ser baixo (A-2-3) ou alto (Q-K-A). Usamos índice 1..13 para 2..K, e A pode ser 0 ou 14.
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function rankIndex(rank) { return RANK_ORDER.indexOf(rank); }

// Retorna índices numéricos tentando A como alto (14) ou baixo (1)
// Para sequência: tenta as duas interpretações do Ás
function rankIndexHigh(rank) {
  if (rank === 'A') return 14;
  return RANK_ORDER.indexOf(rank); // 2=1, 3=2 ... K=13 (reuse same array, offset by 1)
}
// Normalized: 2=2, 3=3 ... K=13, A=1 (low) or 14 (high)
function rankVal(rank, aceHigh) {
  if (rank === 'A') return aceHigh ? 14 : 1;
  return RANK_ORDER.indexOf(rank); // A=0 offset but we won't use A here
}

// Grupo: 3+ cartas do mesmo rank, coringas permitidos (naturais devem ser maioria)
// Excecao: se o rank do grupo for '2', todos os 2s sao naturais (sem coringa)
function isValidTripletGroup(cards) {
  if (cards.length < 3) return false;
  // Checar se todas as cartas tem o mesmo rank (incluindo 2s)
  const allSameRank = cards.every(c => c.rank === cards[0].rank);
  if (allSameRank) return true; // grupo puro (ex: tres 2s, tres As, etc.) sempre valido

  // Grupos mistos: separar naturais (nao-2s) e coringas (2s)
  const naturals = cards.filter(c => !isWild(c));
  const wilds = cards.filter(c => isWild(c));
  if (naturals.length === 0) return false;
  const rank = naturals[0].rank;
  if (!naturals.every(c => c.rank === rank)) return false;
  // Coringas nao podem ser maioria
  if (wilds.length >= naturals.length) return false;
  return true;
}

// Mapeamento consistente: 2=2, 3=3 ... K=13, A=1(baixo) ou A=14(alto)
const RANK_VAL = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};

function _testSeq(naturals, wilds, valFn, minPossible, maxPossible) {
  const rankSet = new Set(naturals.map(c => c.rank));
  if (rankSet.size !== naturals.length) return false;
  const vals = naturals.map(c => valFn(c.rank)).sort((a,b) => a-b);
  const minV = vals[0], maxV = vals[vals.length-1];
  const span = maxV - minV;
  const internalGaps = span - (naturals.length - 1);
  if (internalGaps < 0) return false;
  if (wilds.length < internalGaps) return false;
  const wildcardBorders = wilds.length - internalGaps;
  const leftRoom  = minV - minPossible;
  const rightRoom = maxPossible - maxV;
  if (wildcardBorders > leftRoom + rightRoom) return false;
  return true;
}

// Sequencia: 3+ cartas consecutivas do mesmo naipe
// As pode ser baixo (A=1: A-2-3) ou alto (A=14: Q-K-A)
function isValidSequence(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter(c => !isWild(c));
  const wilds    = cards.filter(c => isWild(c));
  if (naturals.length === 0) return false;
  if (wilds.length >= naturals.length) return false;
  const suit = naturals[0].suit;
  if (!naturals.every(c => c.suit === suit)) return false;

  const hasAce = naturals.some(c => c.rank === 'A');

  if (hasAce) {
    // A baixo: A=1, 2=2 ... K=13, range 1..13
    const valLow  = r => RANK_VAL[r];
    // A alto: A=14, 2=2 ... K=13, range 2..14
    const valHigh = r => r === 'A' ? 14 : RANK_VAL[r];
    return _testSeq(naturals, wilds, valLow,  1, 13) ||
           _testSeq(naturals, wilds, valHigh, 2, 14);
  }
  // Sem As: 2=2 ... K=13
  return _testSeq(naturals, wilds, r => RANK_VAL[r], 2, 13);
}

// Valida qualquer tipo de meld (grupo ou sequencia)
function isValidGroup(cards) {
  return isValidTripletGroup(cards) || isValidSequence(cards);
}

// Ordena as cartas de uma sequencia colocando coringas nos slots que eles preenchem
function sortSequenceCards(cards) {
  const naturals = cards.filter(c => !isWild(c));
  const wilds    = cards.filter(c => isWild(c));
  if (wilds.length === 0) {
    // Sem coringas: ordenar naturais detectando se As e alto ou baixo
    const hasAce = naturals.some(c => c.rank === 'A');
    let aceHigh = false;
    if (hasAce) {
      const vLow  = naturals.map(c => RANK_VAL[c.rank]).sort((a,b)=>a-b);
      const vHigh = naturals.map(c => c.rank==='A'?14:RANK_VAL[c.rank]).sort((a,b)=>a-b);
      aceHigh = (vHigh[vHigh.length-1]-vHigh[0]) < (vLow[vLow.length-1]-vLow[0]);
    }
    return [...naturals].sort((a,b) => {
      const va = a.rank==='A' ? (aceHigh?14:1) : RANK_VAL[a.rank];
      const vb = b.rank==='A' ? (aceHigh?14:1) : RANK_VAL[b.rank];
      return va - vb;
    });
  }

  // Detectar se As e alto ou baixo
  const hasAce = naturals.some(c => c.rank === 'A');
  let aceHigh = false;
  if (hasAce) {
    const vLow  = naturals.map(c => RANK_VAL[c.rank]).sort((a,b)=>a-b);
    const vHigh = naturals.map(c => c.rank==='A'?14:RANK_VAL[c.rank]).sort((a,b)=>a-b);
    aceHigh = (vHigh[vHigh.length-1]-vHigh[0]) < (vLow[vLow.length-1]-vLow[0]);
  }
  const val = r => r==='A' ? (aceHigh?14:1) : RANK_VAL[r];

  // Ordenar naturais
  const sortedNaturals = [...naturals].sort((a,b) => val(a.rank)-val(b.rank));
  const minVal = val(sortedNaturals[0].rank);
  const maxVal = val(sortedNaturals[sortedNaturals.length-1].rank);

  // Construir array de slots: tamanho total = naturals + wilds
  const totalSlots = cards.length;
  // Determinar o valor inicial da sequencia
  // Coringas extras (alem das lacunas internas) vao para as bordas
  const internalGaps = (maxVal - minVal) - (naturals.length - 1);
  const borderWilds  = wilds.length - internalGaps;
  // Distribuir border wilds: preferir esquerda se ha espaco
  const leftBorder  = Math.min(borderWilds, aceHigh ? minVal-2 : minVal-1);
  const rightBorder = borderWilds - leftBorder;

  const startVal = minVal - leftBorder;

  // Preencher slots
  const result = [];
  let ni = 0; // indice em sortedNaturals
  for (let slot = 0; slot < totalSlots; slot++) {
    const slotVal = startVal + slot;
    if (ni < sortedNaturals.length && val(sortedNaturals[ni].rank) === slotVal) {
      result.push(sortedNaturals[ni++]);
    } else {
      result.push(wilds.shift() || sortedNaturals[ni++]); // usar coringa disponivel
    }
  }
  return result;
}

// Determina o tipo do meld para exibicao
function meldType(cards) {
  if (isValidTripletGroup(cards)) return 'group';
  if (isValidSequence(cards)) return 'sequence';
  return null;
}

// Calcula pontos de um conjunto de cartas (sem contar bônus de canastra)
function meldBasePoints(cards) {
  return cards.reduce((s, c) => s + cardPoints(c.rank), 0);
}

// Verifica se um meld tem 7+ cartas (canastra)
function isCanastra(meld) {
  return meld.cards.length >= 7;
}

// Num grupo de 2s ou numa sequencia, o 2 pode estar atuando como carta natural.
// Precisamos saber quantos 2s estao agindo como CORINGAS (substituindo outro rank).
function countWildsActing(meld) {
  if (!meld.type) {
    // fallback: assume todos os 2s sao coringas
    return meld.cards.filter(c => isWild(c)).length;
  }

  if (meld.type === 'group') {
    // Grupo de 2s: nenhum coringa. Grupo de outro rank: todos os 2s sao coringas.
    return meld.cards[0]?.rank === '2' ? 0 : meld.cards.filter(c => isWild(c)).length;
  }

  if (meld.type === 'sequence') {
    // Um 2 e natural numa sequencia se o range completo da sequencia (incluindo
    // extensoes de borda por coringas) passa pelo valor 2 E o 2 e do mesmo naipe.
    const naturals = meld.cards.filter(c => !isWild(c));
    const wilds    = meld.cards.filter(c => isWild(c));
    if (wilds.length === 0) return 0;

    const suit = naturals[0]?.suit;
    const hasAce = naturals.some(c => c.rank === 'A');

    let aceHigh = false;
    if (hasAce) {
      const vLow  = naturals.map(c => RANK_VAL[c.rank]).sort((a,b)=>a-b);
      const vHigh = naturals.map(c => c.rank==='A'?14:RANK_VAL[c.rank]).sort((a,b)=>a-b);
      aceHigh = (vHigh[vHigh.length-1]-vHigh[0]) < (vLow[vLow.length-1]-vLow[0]);
    }
    const valFn = r => (r==='A' ? (aceHigh?14:1) : RANK_VAL[r]);

    const sortedVals = naturals.map(c => valFn(c.rank)).sort((a,b) => a-b);
    const minVal = sortedVals[0];
    const maxVal = sortedVals[sortedVals.length - 1];

    const internalGaps = (maxVal - minVal) - (naturals.length - 1);
    const borderWilds  = wilds.length - internalGaps;

    // Calcular o range completo da sequencia (com extensoes de borda)
    const minPossible = hasAce ? (aceHigh ? 2 : 1) : 2;
    const leftBorder  = Math.min(Math.max(0, borderWilds), minVal - minPossible);
    const startVal    = minVal - leftBorder;
    const endVal      = maxVal + (borderWilds - leftBorder);

    // Um coringa do mesmo naipe que ocupa o slot do rank 2 e natural
    const rank2InRange   = startVal <= 2 && 2 <= endVal;
    const suitedWilds    = suit ? wilds.filter(c => c.suit === suit).length : 0;
    const naturalWilds   = (rank2InRange && suitedWilds > 0) ? 1 : 0;

    return Math.max(0, wilds.length - naturalWilds);
  }

  return meld.cards.filter(c => isWild(c)).length;
}

function isCanastraLimpa(meld) {
  return isCanastra(meld) && countWildsActing(meld) === 0;
}

function isCanastraSuja(meld) {
  return isCanastra(meld) && countWildsActing(meld) > 0;
}

// Calcula pontos de uma mesa (melds baixados por uma dupla)
function calcTablePoints(melds) {
  let pts = 0;
  for (const meld of melds) {
    pts += meldBasePoints(meld.cards);
    if (isCanastraLimpa(meld)) pts += CLEAN_CANASTA_POINTS;
    else if (isCanastraSuja(meld)) pts += DIRTY_CANASTA_POINTS;
  }
  return pts;
}

// Pontos das cartas na mão (negativo quando não bateu)
function calcHandPoints(hand) {
  return hand.reduce((s, c) => s + cardPoints(c.rank), 0);
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────
class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = []; // [{id, name, teamIndex}]
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = [0, 0]; // team 0, team 1
    this.teamNames = ['Dupla 1', 'Dupla 2'];
    this.teamOrders = [[], []]; // teamOrders[t] = [seatIndex, seatIndex] em ordem
    this.playOrder = [0, 1, 2, 3]; // ordem intercalada: T0P0, T1P0, T0P1, T1P1
    this.round = 0;

    // round state
    this.deck = [];
    this.discard = []; // topo = último elemento
    this.hands = [[], [], [], []]; // mãos dos 4 jogadores
    this.melds = [[], []]; // melds de cada dupla: [[{rank, cards[]}], ...]
    this.currentPlayerIndex = 0;
    this.drawnThisTurn = false; // se já comprou/pegou neste turno
    this.hasFirstMeld = [false, false]; // se a dupla já baixou pela primeira vez
  }

  // ── SETUP ──
  addPlayer(socketId, name) {
    if (this.players.length >= 4) return { ok: false, msg: 'Sala cheia.' };
    if (this.status !== 'waiting') return { ok: false, msg: 'Jogo já começou.' };
    // teamIndex indefinido até a dupla ser montada
    const seatIndex = this.players.length;
    this.players.push({ id: socketId, name, teamIndex: -1, seatIndex });
    return { ok: true, seatIndex };
  }

  // Confirmar duplas: teams = [{seatIndex, teamIndex}, ...]
  assignTeams(teams) {
    if (this.status !== 'waiting') return { ok: false, msg: 'Jogo já começou.' };
    if (teams.length !== 4) return { ok: false, msg: 'Informe os times dos 4 jogadores.' };
    const counts = [0, 0];
    for (const { seatIndex, teamIndex } of teams) {
      if (teamIndex !== 0 && teamIndex !== 1) return { ok: false, msg: 'Time inválido.' };
      if (!this.players[seatIndex]) return { ok: false, msg: 'Assento inválido.' };
      counts[teamIndex]++;
    }
    if (counts[0] !== 2 || counts[1] !== 2) return { ok: false, msg: 'Cada time precisa ter exatamente 2 jogadores.' };
    for (const { seatIndex, teamIndex } of teams) {
      this.players[seatIndex].teamIndex = teamIndex;
    }
    this.teamNames = [0, 1].map(t =>
      this.players.filter(p => p.teamIndex === t).map(p => p.name).join(' e ')
    );
    // Ordem dos jogadores dentro de cada time (por seatIndex crescente)
    this.teamOrders = [0, 1].map(t =>
      teams.filter(a => a.teamIndex === t).map(a => a.seatIndex).sort((a, b) => a - b)
    );
    // Ordem de jogo intercalada entre os times: T0P0, T1P0, T0P1, T1P1
    this.playOrder = [
      this.teamOrders[0][0],
      this.teamOrders[1][0],
      this.teamOrders[0][1],
      this.teamOrders[1][1],
    ];
    return { ok: true };
  }

  reconnectPlayer(oldId, newId) {
    const p = this.players.find(p => p.id === oldId);
    if (p) { p.id = newId; return true; }
    return false;
  }

  startRound() {
    this.round++;
    const fullDeck = shuffle(createDeck().concat(createDeck())); // 2 baralhos = 104 cartas
    // na verdade createDeck() já cria 2 baralhos (loop d=0,1), então 1 chamada = 104 cartas
    // vamos usar apenas 1 chamada
    const deck = shuffle(createDeck());
    this.hands = [[], [], [], []];
    this.melds = [[], []];
    this.hasFirstMeld = [false, false];
    this.drawnThisTurn = false;

    // Distribuir 13 cartas para cada jogador
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < 4; p++) {
        this.hands[p].push(deck.pop());
      }
    }

    // Lixo começa vazio — primeiro jogador é obrigado a pescar do monte
    this.discard = [];
    this.deck = deck;
    // Rotação de quem começa: T0P0 → T1P0 → T0P1 → T1P1 → T0P0 …
    const ri = (this.round - 1) % 4;
    this.currentPlayerIndex = this.playOrder[ri] ?? 0;
    this.drawnThisTurn = false;
    this.status = 'playing';
  }

  // ── TURN ACTIONS ──

  // Pescar do monte
  drawFromDeck(playerIndex) {
    if (!this._isCurrentPlayer(playerIndex)) return { ok: false, msg: 'Não é sua vez.' };
    if (this.drawnThisTurn) return { ok: false, msg: 'Você já comprou neste turno.' };
    if (this.deck.length === 0) return { ok: false, msg: 'Monte vazio.' };

    const card = this.deck.pop();
    this.hands[playerIndex].push(card);
    this.drawnThisTurn = true;
    return { ok: true, card };
  }

  // Pegar o lixo inteiro
  takeDiscard(playerIndex) {
    if (!this._isCurrentPlayer(playerIndex)) return { ok: false, msg: 'Não é sua vez.' };
    if (this.drawnThisTurn) return { ok: false, msg: 'Você já comprou neste turno.' };
    if (this.discard.length === 0) return { ok: false, msg: 'Lixo vazio.' };

    const hand = this.hands[playerIndex];
    // Regra especial: se tiver 1 carta na mão e lixo tiver só 1 carta, é obrigado a pescar
    if (hand.length === 1 && this.discard.length === 1) {
      return { ok: false, msg: 'Com 1 carta na mão e 1 no lixo, você é obrigado a pescar do monte.' };
    }

    const pile = [...this.discard];
    this.discard = [];
    this.hands[playerIndex] = [...hand, ...pile];
    this.drawnThisTurn = true;
    return { ok: true, cards: pile };
  }

  // Baixar cartas (first meld ou adicionar a meld existente)
  // meldActions: [{type: 'new', cards: [cardIds]} | {type: 'add', meldIndex: N, cards: [cardIds]}]
  playMelds(playerIndex, meldActions) {
    if (!this._isCurrentPlayer(playerIndex)) return { ok: false, msg: 'Não é sua vez.' };
    if (!this.drawnThisTurn) return { ok: false, msg: 'Você precisa comprar antes de baixar.' };

    const teamIndex = this.players[playerIndex].teamIndex;
    const hand = [...this.hands[playerIndex]];
    const melds = JSON.parse(JSON.stringify(this.melds[teamIndex]));

    // Separar cartas usadas
    const usedIds = new Set();

    for (const action of meldActions) {
      // Resolver IDs → objetos carta da mão
      const cards = action.cards.map(id => {
        const card = hand.find(c => c.id === id && !usedIds.has(c.id));
        if (!card) return null;
        return card;
      });
      if (cards.some(c => !c)) return { ok: false, msg: 'Carta não encontrada na mão.' };

      if (action.type === 'new') {
        const type = meldType(cards);
        if (!type) return { ok: false, msg: 'Combinacao invalida. Use grupo (mesmo rank) ou sequencia (mesmo naipe, ranks consecutivos), com naturais sendo maioria.' };
        const refCard = cards.find(c => c.rank !== '2') || cards[0];
        cards.forEach(c => usedIds.add(c.id));
        // Sort sequence cards so wilds land in their correct positions
        const sortedCards = type === 'sequence' ? sortSequenceCards(cards) : cards;
        melds.push({ rank: refCard.rank, suit: refCard.suit, type, cards: sortedCards });
      } else if (action.type === 'add') {
        const meld = melds[action.meldIndex];
        if (!meld) return { ok: false, msg: 'Meld nao encontrado.' };
        let newCards = [...meld.cards, ...cards];
        const newType = meldType(newCards);
        if (!newType || newType !== meld.type) return { ok: false, msg: 'Adicao invalida ao meld (tipo incompativel).' };
        cards.forEach(c => usedIds.add(c.id));
        // Sort cards so sequence stays in order
        if (newType === 'sequence') {
          newCards = sortSequenceCards(newCards);
        }
        meld.cards = newCards;
      }
    }

    // Verificar first meld — regra do buraco
    if (!this.hasFirstMeld[teamIndex]) {
      const teamScore = this.scores[teamIndex];

      if (teamScore >= FIRST_MELD_MIN_SCORE_THRESHOLD) {
        // ESTÁ NO BURACO: a jogada inteira precisa totalizar >= 100 pontos
        // contando pontos das cartas + bônus de canastra (limpa=200, suja=100)
        const newMelds = melds.filter((_, i) => i >= this.melds[teamIndex].length);
        const newMeldsPoints = newMelds.reduce((sum, m) => {
          let pts = meldBasePoints(m.cards);
          if (isCanastraLimpa(m)) pts += CLEAN_CANASTA_POINTS;
          else if (isCanastraSuja(m)) pts += DIRTY_CANASTA_POINTS;
          return sum + pts;
        }, 0);

        if (newMeldsPoints < 100) {
          return {
            ok: false,
            msg: `Sua dupla está no buraco (${teamScore} pts). A primeira baixa precisa somar pelo menos 100 pontos com bônus de canastra (atual: ${newMeldsPoints} pts).`,
          };
        }
      }
      // Fora do buraco: qualquer combinação válida com 3+ cartas — já validado acima

      this.hasFirstMeld[teamIndex] = true;
    }

    const remainingHand = hand.filter(c => !usedIds.has(c.id));
    const hasCanastraAfter = melds.some(m => isCanastra(m));

    // Não pode baixar e ficar sem cartas suficientes se não tiver canastra
    if (remainingHand.length < 2 && !hasCanastraAfter) {
      return { ok: false, msg: 'Você precisa guardar pelo menos 2 cartas na mão para baixar (1 para descartar e 1 extra). Sua dupla ainda não tem canastra.' };
    }

    // Aplicar
    this.melds[teamIndex] = melds;
    this.hands[playerIndex] = remainingHand;

    // Baixou todas as cartas e tem canastra → bater automático
    if (remainingHand.length === 0 && hasCanastraAfter) {
      return this._autoBater(playerIndex, teamIndex);
    }

    return { ok: true };
  }

  // Descartar e encerrar turno
  discard_(playerIndex, cardId) {
    if (!this._isCurrentPlayer(playerIndex)) return { ok: false, msg: 'Não é sua vez.' };
    if (!this.drawnThisTurn) return { ok: false, msg: 'Você precisa comprar antes de descartar.' };

    const hand = this.hands[playerIndex];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok: false, msg: 'Carta não encontrada na mão.' };

    const [card] = hand.splice(idx, 1);

    // Descartou a última carta → bater automático (exige canastra)
    if (hand.length === 0) {
      const teamIndex = this.players[playerIndex].teamIndex;
      const hasCanastra = this.melds[teamIndex].some(m => isCanastra(m));
      if (!hasCanastra) {
        hand.splice(idx, 0, card); // desfaz
        return { ok: false, msg: 'Sua dupla precisa ter pelo menos 1 canastra para descartar a última carta.' };
      }
      this.discard.push(card);
      return this._autoBater(playerIndex, teamIndex);
    }

    this.discard.push(card);
    this.drawnThisTurn = false;
    this._advanceTurn();
    return { ok: true, card };
  }

  // Bater (encerrar rodada)
  bater(playerIndex, discardCardId = null) {
    if (!this._isCurrentPlayer(playerIndex)) return { ok: false, msg: 'Não é sua vez.' };
    if (!this.drawnThisTurn) return { ok: false, msg: 'Você precisa comprar antes de bater.' };

    const teamIndex = this.players[playerIndex].teamIndex;

    // Precisa de pelo menos 1 canastra
    const hasCanastra = this.melds[teamIndex].some(m => isCanastra(m));
    if (!hasCanastra) return { ok: false, msg: 'Sua dupla precisa ter pelo menos 1 canastra para bater.' };

    // Descartar se quiser
    if (discardCardId) {
      const hand = this.hands[playerIndex];
      const idx = hand.findIndex(c => c.id === discardCardId);
      if (idx === -1) return { ok: false, msg: 'Carta para descartar não encontrada.' };
      const [card] = hand.splice(idx, 1);
      this.discard.push(card);
    }

    this._batterIndex = playerIndex;
    return this._endRound(teamIndex);
  }

  // ── ROUND END ──
  _autoBater(playerIndex, teamIndex) {
    this._batterIndex = playerIndex;
    return { autoBater: true, ...this._endRound(teamIndex) };
  }

  _endRound(winningTeam) {
    const roundPoints = [0, 0];

    for (let t = 0; t < 2; t++) {
      roundPoints[t] += calcTablePoints(this.melds[t]);
      if (t === winningTeam) roundPoints[t] += BATER_BONUS;
    }

    // Subtrair cartas na mão de todos os jogadores que não bateram,
    // inclusive o parceiro de quem bateu (apenas quem bateu não perde a mão)
    for (let p = 0; p < 4; p++) {
      if (p !== this._batterIndex) {
        const t = this.players[p].teamIndex;
        roundPoints[t] -= calcHandPoints(this.hands[p]);
      }
    }

    this.scores[0] += roundPoints[0];
    this.scores[1] += roundPoints[1];

    const gameOver = this.scores[0] >= WIN_SCORE || this.scores[1] >= WIN_SCORE;
    if (gameOver) {
      this.status = 'finished';
    } else {
      this.status = 'roundOver'; // waiting for players to click Continue
    }

    // Build detailed per-team meld breakdown
    const teamMeldDetails = [0, 1].map(t => {
      let cardsPoints = 0;
      let canastrasLimpas = 0;
      let canastrasSujas = 0;
      this.melds[t].forEach(m => {
        cardsPoints += meldBasePoints(m.cards);
        if (isCanastraLimpa(m)) canastrasLimpas++;
        else if (isCanastraSuja(m)) canastrasSujas++;
      });
      return {
        cardsPoints,
        canastrasLimpas,
        canastrasSujas,
        canastrasBonus: canastrasLimpas * CLEAN_CANASTA_POINTS + canastrasSujas * DIRTY_CANASTA_POINTS,
        baterBonus: t === winningTeam ? BATER_BONUS : 0,
      };
    });

    // Per-player hand loss
    const playerHandLoss = this.players.map((p, i) => ({
      playerName: p?.name,
      teamIndex: p?.teamIndex,
      isBatter: i === this._batterIndex,
      hand: this.hands[i],
      handPoints: i === this._batterIndex ? 0 : calcHandPoints(this.hands[i]),
    }));

    return {
      ok: true,
      winningTeam,
      winnerPlayerName: this.players[this._batterIndex]?.name,
      roundPoints,
      scores: [...this.scores],
      gameOver,
      winnerTeam: gameOver ? (this.scores[0] >= WIN_SCORE ? 0 : 1) : null,
      teamMeldDetails,
      playerHandLoss,
      teamNames: this.teamNames,
      round: this.round,
    };
  }

  // ── HELPERS ──
  _isCurrentPlayer(playerIndex) {
    return playerIndex === this.currentPlayerIndex;
  }

  _advanceTurn() {
    const pos = this.playOrder.indexOf(this.currentPlayerIndex);
    this.currentPlayerIndex = this.playOrder[(pos + 1) % 4];
    this.drawnThisTurn = false;
  }

  // Snapshot para enviar ao cliente (esconde mãos dos outros jogadores)
  getStateFor(playerIndex) {
    return {
      roomId: this.roomId,
      status: this.status,
      round: this.round,
      scores: this.scores,
      players: this.players.map(p => ({ name: p.name, teamIndex: p.teamIndex })),
      currentPlayerIndex: this.currentPlayerIndex,
      drawnThisTurn: this.drawnThisTurn,
      hasFirstMeld: this.hasFirstMeld,
      myHand: this.hands[playerIndex] || [],
      handSizes: this.hands.map(h => h.length),
      melds: this.melds,
      discardTop: this.discard.length > 0 ? this.discard[this.discard.length - 1] : null,
      discardSize: this.discard.length,
      deckSize: this.deck.length,
      myIndex: playerIndex,
      myTeam: this.players[playerIndex]?.teamIndex,
      teamNames: this.teamNames,
    };
  }
}

module.exports = { Game, CLEAN_CANASTA_POINTS, DIRTY_CANASTA_POINTS, WIN_SCORE };
