import socket from '../socket.js';
import { isRed } from '../utils.js';

// ─── INLINE DISCARD PILE EXPAND ──────────────────────────────────────────────
let discardExpanded = false;

document.getElementById('btn-expand-discard').addEventListener('click', (e) => {
  e.stopPropagation();
  discardExpanded = !discardExpanded;
  toggleDiscardExpand();
});

function toggleDiscardExpand() {
  const dropdown = document.getElementById('discard-dropdown');
  const btn = document.getElementById('btn-expand-discard');
  if (discardExpanded) {
    socket.emit('getDiscardPile', {}, (res) => {
      if (!res.ok) return;
      renderDiscardDropdown(res.cards);
      dropdown.classList.remove('hidden');
      btn.textContent = '▲';
    });
  } else {
    dropdown.classList.add('hidden');
    btn.textContent = '▼';
  }
}

function renderDiscardDropdown(cards) {
  const container = document.getElementById('discard-dropdown-cards');
  const countEl   = document.getElementById('discard-dropdown-count');
  countEl.textContent = `Pilha de descarte (${cards.length} cartas)`;
  container.innerHTML = '';
  cards.forEach(card => {
    const red = isRed(card.suit) ? 'red' : '';
    container.insertAdjacentHTML('beforeend',
      `<div class="discard-view-card ${red}">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit">${card.suit}</span>
      </div>`
    );
  });
}

document.getElementById('btn-close-discard-dropdown').addEventListener('click', () => {
  discardExpanded = false;
  document.getElementById('discard-dropdown').classList.add('hidden');
  document.getElementById('btn-expand-discard').textContent = '▼';
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const pile = document.getElementById('discard-pile');
  const dropdown = document.getElementById('discard-dropdown');
  if (discardExpanded && !pile.contains(e.target) && !dropdown.contains(e.target)) {
    discardExpanded = false;
    dropdown.classList.add('hidden');
    document.getElementById('btn-expand-discard').textContent = '▼';
  }
});
