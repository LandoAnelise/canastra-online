import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, autoSortHand } from '../utils.js';
import { getDragCardId, renderMe, updateButtons, clearSelection } from './render.js';

document.getElementById('btn-draw').addEventListener('click', () => {
  const prevIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => {
    if (!res.ok) showToast(res.msg, 'error');
    // justDrawnCardId will be set in next gameState update via prevIds comparison
    window._prevHandIds = prevIds;
  });
});

document.getElementById('btn-take-discard').addEventListener('click', () => {
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('takeDiscard', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

document.getElementById('btn-play-melds').addEventListener('click', () => {
  if (state.selectedCards.length < 3) { showToast('Selecione pelo menos 3 cartas.', 'error'); return; }
  socket.emit('playMelds', { meldActions: [{ type: 'new', cards: [...state.selectedCards] }] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    showToast('Grupo baixado!', 'success'); clearSelection();
  });
});

document.getElementById('btn-discard').addEventListener('click', () => {
  if (state.selectedCards.length !== 1) { showToast('Selecione exatamente 1 carta para descartar.', 'error'); return; }
  socket.emit('discard', { cardId: state.selectedCards[0] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    clearSelection();
  });
});

document.getElementById('btn-bater').addEventListener('click', () => {
  const discardCardId = state.selectedCards.length === 1 ? state.selectedCards[0] : null;
  socket.emit('bater', { discardCardId }, res => {
    if (!res?.ok) { showToast(res?.msg || 'Erro ao bater.', 'error'); return; }
    clearSelection();
  });
});

document.getElementById('btn-sort-hand').addEventListener('click', () => {
  if (!state.gameState) return;
  state.myHandOrder = autoSortHand(state.gameState.myHand).map(c => c.id);
  renderMe(state.gameState);
  showToast('Cartas reordenadas!', 'success', 1400);
});

document.getElementById('deck-pile').addEventListener('click', () => {
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || state.gameState.drawnThisTurn) return;
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

document.getElementById('discard-pile').addEventListener('click', (e) => {
  // Don't trigger take-discard if clicking the expand button
  if (e.target.id === 'btn-expand-discard') return;
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || state.gameState.drawnThisTurn) return;
  if (!state.gameState.discardTop) { showToast('O lixo está vazio.', 'error'); return; }
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('takeDiscard', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

// ─── DRAG CARD TO DISCARD PILE ────────────────────────────────────────────────
const discardPileEl = document.getElementById('discard-pile');

discardPileEl.addEventListener('dragover', (e) => {
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || !state.gameState.drawnThisTurn) return;
  if (!getDragCardId()) return;
  e.preventDefault();
  discardPileEl.classList.add('drop-target');
});

discardPileEl.addEventListener('dragleave', () => {
  discardPileEl.classList.remove('drop-target');
});

discardPileEl.addEventListener('drop', (e) => {
  e.preventDefault();
  discardPileEl.classList.remove('drop-target');
  if (!getDragCardId()) return;
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || !state.gameState.drawnThisTurn) return;
  socket.emit('discard', { cardId: getDragCardId() }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    clearSelection();
  });
});
