import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, autoSortHand, sortHandByRank } from '../utils.js';
import { getDragCardId, renderMe, updateButtons, clearSelection, renderStagedMelds, renderMelds } from './render.js';
import { playFolhaVirando, playWhoosh, playDeal, playBzz, playThud, isMuted, toggleMute } from '../sounds.js';

function errSound(res) { if (!res.ok) playBzz(); }

function isInBuraco(gs) {
  return gs && !gs.hasFirstMeld[gs.myTeam] && gs.scores[gs.myTeam] >= 1000;
}

function commitStagedMelds() {
  const meldActions = state.stagedMelds.slice();
  socket.emit('playMelds', { meldActions }, res => {
    if (!res.ok) {
      // Return cards to hand — cancel staging
      cancelStaging();
      showToast(res.msg || 'Os jogos juntos não somam >= 100 pts', 'error');
      playBzz();
      return;
    }
    const isSeq = res.meldTypes?.includes('sequence');
    showToast(isSeq ? 'Sequência baixada!' : 'Grupo baixado!', 'success', 1000);
    playDeal();
    state.stagedMelds = [];
    state.stagedCardIds = new Set();
    clearSelection();
  });
}

function cancelStaging() {
  state.stagedMelds = [];
  state.stagedCardIds = new Set();
  clearSelection();
  if (state.gameState) {
    renderMelds(state.gameState);
    renderStagedMelds(state.gameState);
  }
}

document.getElementById('btn-play-melds').addEventListener('click', () => {
  const gs = state.gameState;
  if (gs?.currentPlayerIndex !== state.mySeatIndex) { showToast('Aguarde seu turno para jogar.', 'error'); playBzz(); return; }
  if (!gs?.drawnThisTurn) { showToast('Compre ou junte da mesa antes de jogar.', 'error'); playBzz(); return; }
  if (state.selectedCards.length < 3) { showToast('Selecione pelo menos 3 cartas.', 'error'); playBzz(); return; }
  if (isInBuraco(gs)) {
    // Stage the meld instead of submitting
    const action = { type: 'new', cards: [...state.selectedCards] };
    state.stagedMelds.push(action);
    state.selectedCards.forEach(id => state.stagedCardIds.add(id));
    state.selectedCards = [];
    renderMe(gs);
    renderMelds(gs);
    renderStagedMelds(gs);
    updateButtons(gs);
    return;
  }
  socket.emit('playMelds', { meldActions: [{ type: 'new', cards: [...state.selectedCards] }] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    const isSeq = res.meldTypes?.includes('sequence');
    showToast(isSeq ? 'Sequência baixada!' : 'Grupo baixado!', 'success', 1000);
    playDeal(); clearSelection();
  });
});

document.getElementById('btn-confirm-melds').addEventListener('click', () => {
  if (state.stagedMelds.length === 0) return;
  commitStagedMelds();
});

document.getElementById('btn-cancel-melds').addEventListener('click', () => {
  cancelStaging();
});

document.getElementById('btn-discard').addEventListener('click', () => {
  if (state.selectedCards.length !== 1) { showToast('Selecione exatamente 1 carta para descartar.', 'error'); playBzz(); return; }
  socket.emit('discard', { cardId: state.selectedCards[0] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    clearSelection();
  });
});

document.getElementById('btn-bater').addEventListener('click', () => {
  const discardCardId = state.selectedCards.length === 1 ? state.selectedCards[0] : null;
  socket.emit('bater', { discardCardId }, res => {
    if (!res?.ok) { showToast(res?.msg || 'Erro ao bater.', 'error'); playBzz(); return; }
    clearSelection();
  });
});

document.getElementById('btn-sort-hand').addEventListener('click', () => {
  if (!state.gameState) return;
  state.myHandOrder = autoSortHand(state.gameState.myHand).map(c => c.id);
  renderMe(state.gameState);
  showToast('Ordenado por naipe!', 'success', 1000);
});

document.getElementById('btn-sort-rank').addEventListener('click', () => {
  if (!state.gameState) return;
  state.myHandOrder = sortHandByRank(state.gameState.myHand).map(c => c.id);
  renderMe(state.gameState);
  showToast('Ordenado por número!', 'success', 1000);
});

// ── Botão mute ────────────────────────────────────────────────────────────────
const btnMute = document.getElementById('btn-mute');
btnMute.textContent = isMuted() ? '🔇' : '🔊';
btnMute.addEventListener('click', () => {
  const muted = toggleMute();
  btnMute.textContent = muted ? '🔇' : '🔊';
});

// ── Clique no monte ───────────────────────────────────────────────────────────
document.getElementById('deck-pile').addEventListener('click', () => {
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || state.gameState.drawnThisTurn) { playThud(); return; }
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => {
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    playFolhaVirando();
  });
});

document.getElementById('discard-pile').addEventListener('click', (e) => {
  if (e.target.id === 'btn-expand-discard') return;
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || state.gameState.drawnThisTurn) { playThud(); return; }
  if (!state.gameState.discardTop) { showToast('O lixo está vazio.', 'error'); playBzz(); return; }
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('takeDiscard', {}, res => {
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    playWhoosh();
  });
});

// ── Drag carta para lixo ──────────────────────────────────────────────────────
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
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    clearSelection();
  });
});
