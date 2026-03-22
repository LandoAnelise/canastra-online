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
export function isCanastraLimpa(meld) { return isCanastra(meld) && meld.cards.every(c => !isWild(c)); }
export function isCanastraSuja(meld)  { return isCanastra(meld) && meld.cards.some(c => isWild(c)); }

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
