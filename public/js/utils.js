// Suit interleaved by color: ♠(black) ♦(red) ♣(black) ♥(red)
export const SUIT_ORDER = { '♠': 0, '♦': 1, '♣': 2, '♥': 3 };
export const RANK_ORDER_SORT = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

export function autoSortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER_SORT.indexOf(a.rank) - RANK_ORDER_SORT.indexOf(b.rank);
  });
}

export function isRed(suit) { return suit === '♥' || suit === '♦'; }
export function isWild(card) { return card.rank === '2'; }

export function cardHTML(card, extra = '') {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  return `<div class="my-card ${red} ${wild} ${extra}" data-id="${card.id}" draggable="true">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

export function miniCardHTML(card) {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  return `<div class="meld-mini-card ${red} ${wild}"><span>${card.rank}</span><span>${card.suit}</span></div>`;
}

export function discardCardHTML(card) {
  if (!card) return '<div class="pile-card front" style="opacity:0.25"><span>vazio</span></div>';
  const red = isRed(card.suit) ? 'red' : '';
  return `<div class="pile-card front ${red}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

export function isCanastra(meld) { return meld.cards.length >= 7; }

const _RANK_VAL = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};

function _wildsActingInSequence(meld) {
  const naturals = meld.cards.filter(c => !isWild(c));
  const wilds    = meld.cards.filter(c => isWild(c));
  if (wilds.length === 0) return 0;
  const suit = naturals[0]?.suit;
  if (!suit) return wilds.length;
  const hasAce = naturals.some(c => c.rank === 'A');
  const valFn  = r => (r === 'A' ? 1 : _RANK_VAL[r]);
  const sortedVals = naturals.map(c => valFn(c.rank)).sort((a,b) => a-b);
  const minVal = sortedVals[0];
  const maxVal = sortedVals[sortedVals.length - 1];
  const internalGaps = (maxVal - minVal) - (naturals.length - 1);
  const borderWilds  = wilds.length - internalGaps;
  const minPossible  = hasAce ? 1 : 2;
  const leftBorder   = Math.min(Math.max(0, borderWilds), minVal - minPossible);
  const startVal     = minVal - leftBorder;
  const endVal       = maxVal + (borderWilds - leftBorder);
  const rank2InRange = startVal <= 2 && 2 <= endVal;
  const suitedWilds  = wilds.filter(c => c.suit === suit).length;
  const naturalWilds = (rank2InRange && suitedWilds > 0) ? 1 : 0;
  return Math.max(0, wilds.length - naturalWilds);
}

export function isCanastraLimpa(meld) {
  if (!isCanastra(meld)) return false;
  const wilds = meld.cards.filter(c => isWild(c));
  if (wilds.length === 0) return true;
  if (meld.type !== 'sequence') return false;
  return _wildsActingInSequence(meld) === 0;
}

export function isCanastraSuja(meld) {
  if (!isCanastra(meld)) return false;
  const wilds = meld.cards.filter(c => isWild(c));
  if (wilds.length === 0) return false;
  if (meld.type !== 'sequence') return true;
  return _wildsActingInSequence(meld) > 0;
}

export function showToast(msg, type = '', duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = type;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.add('hidden'), duration);
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

export function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
