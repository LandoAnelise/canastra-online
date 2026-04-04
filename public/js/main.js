import socket from './socket.js';
import { state } from './state.js';
import { showToast, showScreen, closeModal } from './utils.js';
import { playCampainha, playFolhaVirando, playWhoosh, playDeal, playBzz } from './sounds.js';
import { loadSession, clearSession } from './session.js';

let _prevTurnIdx = -1;
import './screens/lobby.js';
import { renderWaiting, renderReadyScreen } from './screens/waiting.js';
import { renderTeamSelection } from './screens/teams.js';
import { renderGame, renderMelds, clearSelection, resetRoundState } from './game/render.js';
import './game/actions.js';
import './game/discard.js';
import './game/modals.js';
import { renderPublicRooms } from './screens/lobby.js';
import { showRoundModal, showGameOverModal } from './game/modals.js';

socket.on('playerJoined', ({ playerName, totalPlayers }) => {
  showToast(`${playerName} entrou na sala (${totalPlayers}/4)`);
});

socket.on('teamsAssigned', ({ players }) => {
  state.teamsInitialized = false; // allow re-setup when teams change
  state.readyPlayers = new Set();
  state.iAmReady = false;
  document.getElementById('ready-room-code').textContent = state.myRoomId;
  showScreen('screen-ready');
  renderReadyScreen(players);
});

socket.on('readyUpdate', ({ readyPlayers: rp, totalPlayers }) => {
  state.readyPlayers = new Set(rp);
  if (state.gameState) renderReadyScreen(state.gameState.players);
  const hint = document.getElementById('ready-hint');
  if (hint) hint.textContent = `${rp.length} de ${totalPlayers} prontos…`;
});

socket.on('roundStarted', ({ round }) => {
  showToast(`🃏 Rodada ${round} começando!`, 'success', 1000);
  state.myHandOrder = [];
  closeModal('modal-round');
  clearSelection();
  resetRoundState();
  // Restaurar botões/pilhas que foram ocultados pelo roundEnded
  ['btn-play-melds', 'btn-discard', 'deck-pile', 'discard-pile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = false; el.classList.remove('hidden'); }
  });
});

socket.on('playerDisconnected', ({ playerName, reconnectWindowMs }) => {
  if (!reconnectWindowMs) {
    // Pre-game disconnect — just notify
    showToast(`⚠️ ${playerName || 'Jogador'} desconectou`, 'error', 5000);
  }
  // If reconnectWindowMs is set, gamePaused event handles the UI
});

socket.on('playerDrew', () => { playFolhaVirando(); });
socket.on('playerTookDiscard', () => { playWhoosh(); });
socket.on('playerDealt', () => { playDeal(); });

socket.on('roundEnded', (result) => {
  // Desabilita todos os botões de ação imediatamente — rodada encerrada (mas mantém visíveis)
  ['btn-play-melds', 'btn-confirm-melds', 'btn-cancel-melds', 'btn-discard', 'btn-bater',
   'deck-pile', 'discard-pile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = true; }
  });

  window._roundEndedPending = true;
  setTimeout(() => {
    window._roundEndedPending = false;
    showRoundModal(result);
  }, 2500);
});

socket.on('deckEmpty', ({ playerName }) => {
  showToast(`⚠️ Monte acabou! ${playerName} joga sua última mão e a rodada encerra.`, 'error', 5000);
});

socket.on('stagingPenalty', ({ playerName, teamName }) => {
  showToast(`⚠️ ${playerName} (${teamName}) tentou baixar com pontos insuficientes! Penalidade: agora precisam de 150 pts.`, 'error', 6000);
  playBzz();
});

socket.on('gameState', (gs) => {
  state.gameState = gs;
  if (gs.myIndex !== undefined) state.mySeatIndex = gs.myIndex;
  // Campainha quando passa a ser minha vez
  if (gs.status === 'playing' && gs.currentPlayerIndex === state.mySeatIndex && _prevTurnIdx !== state.mySeatIndex) {
    playCampainha();
  }
  _prevTurnIdx = gs.currentPlayerIndex;

  if (gs.status === 'waiting') {
    renderWaiting(gs);
    if (gs.players.length === 4 && gs.players.some(p => p.teamIndex === -1)) {
      showScreen('screen-teams');
      renderTeamSelection(gs);
    } else if (gs.players.length < 4) {
      showScreen('screen-waiting');
    }
    // if on ready screen, keep it — readyUpdate handles the render
  } else {
    // hand order is managed inside renderGame
    renderGame(gs);
    if (!document.getElementById('screen-game').classList.contains('active')) {
      showScreen('screen-game');
    }
  }
});

socket.on('publicRoomsUpdated', ({ rooms }) => {
  const panel = document.getElementById('panel-browse');
  if (!panel.classList.contains('hidden')) renderPublicRooms(rooms);
});


// ── Auto-reconexão ao carregar a página ───────────────────────────────────────
let _autoReconnectDone = false;
socket.on('connect', () => {
  console.log('Conectado');
  if (_autoReconnectDone) return;
  _autoReconnectDone = true;

  const session = loadSession();
  if (!session) return;

  showToast('Reconectando à partida...', 'info', 3000);
  socket.emit('joinRoom', { roomId: session.roomId, playerName: session.playerName }, (res) => {
    if (!res.ok) {
      clearSession();
      showToast('Sessão expirada. Entre novamente.', 'error', 3000);
      return;
    }
    state.myName    = session.playerName;
    state.myRoomId  = session.roomId;
    state.mySeatIndex = res.seatIndex;
    // Preenche o nome no campo do lobby caso o jogador volte ao lobby depois
    const nameInput = document.getElementById('input-name');
    if (nameInput && !nameInput.value) nameInput.value = session.playerName;

    if (res.reconnected) {
      showToast('✅ Reconectado!', 'success', 1500);
      // gameState chegará em seguida e renderizará o jogo automaticamente
    } else {
      // Estava em sala de espera — volta para a tela de espera
      document.getElementById('waiting-room-code').textContent = session.roomId;
      showScreen('screen-waiting');
    }
  });
});

socket.on('disconnect', () => showToast('⚠️ Conexão perdida. Reconectando...', 'error', 8000));
socket.on('connect_error', () => showToast('Erro de conexão.', 'error', 5000));

// ── Escala proporcional para telas menores que o design mínimo ────────────────
const DESIGN_MIN_W = 360; // largura mínima de referência (px)
function applyMobileScale() {
  const game = document.getElementById('screen-game');
  if (!game) return;
  const vw = window.innerWidth;
  if (vw < DESIGN_MIN_W) {
    const scale = vw / DESIGN_MIN_W;
    game.style.transformOrigin = 'top left';
    game.style.transform = `scale(${scale})`;
    game.style.width = DESIGN_MIN_W + 'px';
    game.style.height = (window.innerHeight / scale) + 'px';
  } else {
    game.style.transform = '';
    game.style.width = '';
    game.style.height = '';
  }
}
window.addEventListener('resize', applyMobileScale);
applyMobileScale();
