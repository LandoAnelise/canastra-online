import socket from './socket.js';
import { state } from './state.js';
import { showToast, showScreen, closeModal } from './utils.js';
import './screens/lobby.js';
import { renderWaiting, renderReadyScreen } from './screens/waiting.js';
import { renderTeamSelection } from './screens/teams.js';
import { renderGame, renderMelds, clearSelection } from './game/render.js';
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
  showToast(`🃏 Rodada ${round} começando!`, 'success');
  state.myHandOrder = [];
  closeModal('modal-round');
  clearSelection();
});

socket.on('playerDisconnected', ({ playerName, reconnectWindowMs }) => {
  if (!reconnectWindowMs) {
    // Pre-game disconnect — just notify
    showToast(`⚠️ ${playerName || 'Jogador'} desconectou`, 'error', 5000);
  }
  // If reconnectWindowMs is set, gamePaused event handles the UI
});

socket.on('roundEnded', (result) => { showRoundModal(result); });

socket.on('gameState', (gs) => {
  state.gameState = gs;

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

socket.on('connect', () => console.log('Conectado'));
socket.on('disconnect', () => showToast('⚠️ Conexão perdida. Reconectando...', 'error', 8000));
socket.on('connect_error', () => showToast('Erro de conexão.', 'error', 5000));
