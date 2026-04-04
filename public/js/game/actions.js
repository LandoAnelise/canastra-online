import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, autoSortHand, sortHandByRank } from '../utils.js';
import { getDragCardId, renderMe, updateButtons, clearSelection } from './render.js';
import { playFolhaVirando, playWhoosh, playDeal, playBzz, playThud, isMuted, toggleMute } from '../sounds.js';

function isInBuraco(gs) {
  return gs && !gs.hasFirstMeld[gs.myTeam] && gs.scores[gs.myTeam] >= 1000;
}

document.getElementById('btn-play-melds').addEventListener('click', () => {
  const gs = state.gameState;
  if (gs?.currentPlayerIndex !== state.mySeatIndex) { showToast('Aguarde seu turno para jogar.', 'error'); playBzz(); return; }
  if (!gs?.drawnThisTurn) { showToast('Compre ou junte da mesa antes de jogar.', 'error'); playBzz(); return; }
  if (state.selectedCards.length < 3) { showToast('Selecione pelo menos 3 cartas.', 'error'); playBzz(); return; }
  if (isInBuraco(gs)) {
    // Staging é feito no servidor — emite stageMeld
    socket.emit('stageMeld', { cardIds: [...state.selectedCards] }, res => {
      if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
      clearSelection();
    });
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
  const gs = state.gameState;
  const hasStagedMelds = (gs?.stagedMelds?.[gs.myIndex]?.length ?? 0) > 0;
  if (!hasStagedMelds) return;
  socket.emit('confirmStagedMelds', {}, res => {
    if (!res.ok) {
      showToast(res.msg || 'Pontos insuficientes.', 'error', res.penalized ? 6000 : 3000);
      playBzz();
      return;
    }
    const isSeq = res.meldTypes?.includes('sequence');
    showToast(isSeq ? 'Sequência baixada!' : 'Grupo baixado!', 'success', 1000);
    playDeal();
  });
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

// ── Botão tela cheia ──────────────────────────────────────────────────────────
const btnFullscreen = document.getElementById('btn-fullscreen');
function updateFullscreenIcon() {
  btnFullscreen.textContent = document.fullscreenElement ? '⊡' : '⛶';
}
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});
document.addEventListener('fullscreenchange', updateFullscreenIcon);

// ── Botão esconder/mostrar topbar ─────────────────────────────────────────────
const screenGame = document.getElementById('screen-game');
document.getElementById('btn-hide-topbar').addEventListener('click', () => {
  screenGame.classList.add('topbar-hidden');
});
document.getElementById('topbar-reveal').addEventListener('click', () => {
  screenGame.classList.remove('topbar-hidden');
});

// ── Clique no monte ───────────────────────────────────────────────────────────
document.getElementById('deck-pile').addEventListener('click', () => {
  if (window._roundEndedPending) return;
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || state.gameState.drawnThisTurn) { playThud(); return; }
  window._prevHandIds = new Set(state.gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => {
    if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
    playFolhaVirando();
  });
});

document.getElementById('discard-pile').addEventListener('click', (e) => {
  if (e.target.id === 'btn-expand-discard') return;
  if (window._roundEndedPending) return;
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
