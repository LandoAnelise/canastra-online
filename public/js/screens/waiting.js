import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, showScreen } from '../utils.js';

export function renderWaiting(gs) {
  const seats = document.getElementById('waiting-seats');
  seats.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = gs.players[i];
    const isBot = gs.botSeats?.includes(i);
    const div = document.createElement('div');
    div.className = `seat-item${p ? '' : ' empty'}${isBot ? ' bot-seat' : ''}`;
    div.innerHTML = `
      <span class="seat-name">${p ? p.name : 'Aguardando...'}</span>
      ${gs.isLeader && isBot ? `<button class="btn-kick-bot" data-seat="${i}">Remover bot</button>` : ''}
    `;
    seats.appendChild(div);
  }

  // Exibe controles de bot apenas para o líder enquanto há vagas
  const botControls = document.getElementById('waiting-bot-controls');
  if (gs.isLeader && gs.players.length < 4) {
    botControls.classList.remove('hidden');
  } else {
    botControls.classList.add('hidden');
  }
}

const TEAM_LABEL = ['🔵 Dupla 1', '🔴 Dupla 2'];
const TEAM_CLASS = ['team0', 'team1'];

export function renderReadyScreen(players) {
  const list = document.getElementById('ready-players-list');
  if (!list || !players) return;
  list.innerHTML = '';

  // Group by team: [team0 players, team1 players]
  const byTeam = [[], []];
  players.forEach((p, i) => {
    if (p?.teamIndex === 0 || p?.teamIndex === 1) byTeam[p.teamIndex].push({ p, i });
  });

  const botSeats = state.gameState?.botSeats || [];

  byTeam.forEach((members, t) => {
    if (members.length === 0) return;

    const header = document.createElement('div');
    header.className = `ready-team-header ${TEAM_CLASS[t]}`;
    header.textContent = TEAM_LABEL[t];
    list.appendChild(header);

    members.forEach(({ p, i }) => {
      const isReady = state.readyPlayers.has(i);
      const isMe = i === state.mySeatIndex;
      const isBot = botSeats.includes(i);
      const row = document.createElement('div');
      row.className = `ready-player-row${isReady ? ' is-ready' : ''}`;
      row.innerHTML = `
        <span class="rp-name${isMe ? ' me' : ''}">${isBot ? '🤖 ' : ''}${p.name}${isMe ? ' (você)' : ''}</span>
        <span class="rp-status">${isReady ? '✅ Pronto!' : 'Aguardando…'}</span>`;
      list.appendChild(row);
    });
  });

  const btn = document.getElementById('btn-ready');
  if (state.iAmReady) {
    btn.textContent = '✅ Você está pronto!';
    btn.classList.add('already-ready');
    btn.disabled = true;
  } else {
    btn.textContent = '✅ Estou Pronto!';
    btn.classList.remove('already-ready');
    btn.disabled = false;
  }
}

document.getElementById('btn-leave-waiting').addEventListener('click', leavePreGame);

function leavePreGame() {
  socket.emit('leaveRoom');
  state.myRoomId = null;
  state.gameState = null;
  state.teamsInitialized = false;
  history.replaceState(null, '', '/');
  showScreen('screen-lobby');
}

document.getElementById('btn-leave-teams').addEventListener('click', leavePreGame);
document.getElementById('btn-leave-ready').addEventListener('click', leavePreGame);

document.getElementById('btn-ready').addEventListener('click', () => {
  if (state.iAmReady) return;
  state.iAmReady = true;
  socket.emit('playerReady', {}, (res) => {
    if (!res.ok) {
      showToast(res.msg, 'error');
      state.iAmReady = false;
      return;
    }
    state.readyPlayers.add(state.mySeatIndex);
    if (state.gameState) renderReadyScreen(state.gameState.players);
  });
});

// ── Controles de bot na sala de espera ──────────────────────────────────────

document.getElementById('btn-add-bot').addEventListener('click', () => {
  const difficulty = document.getElementById('waiting-bot-difficulty').value || 'medium';
  socket.emit('addBotToRoom', { difficulty }, (res) => {
    if (!res.ok) {
      showToast(res.msg || 'Erro ao adicionar bot.', 'error');
      return;
    }
    showToast(`🤖 ${res.botName} adicionado!`, 'success', 1500);
    // renderWaiting será chamado via gameState broadcast pelo servidor
  });
});

document.getElementById('waiting-seats').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-kick-bot');
  if (!btn) return;
  if (btn.disabled) return;
  const seatIndex = parseInt(btn.dataset.seat);
  if (!Number.isInteger(seatIndex)) return;

  btn.disabled = true;
  socket.timeout(3000).emit('kickBotFromRoom', { seatIndex }, (err, res) => {
    btn.disabled = false;
    if (err) {
      showToast('Servidor não respondeu ao remover o bot. Atualize a página e tente novamente.', 'error');
      return;
    }
    if (!res?.ok) {
      showToast(res?.msg || 'Erro ao remover bot.', 'error');
      return;
    }
    showToast(`🤖 ${res.botName} removido.`, 'success', 1500);
  });
});
