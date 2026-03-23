import socket from '../socket.js';
import { state } from '../state.js';
import { showToast } from '../utils.js';

export function renderWaiting(gs) {
  const seats = document.getElementById('waiting-seats');
  seats.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = gs.players[i];
    const div = document.createElement('div');
    div.className = `seat-item ${p ? '' : 'empty'}`;
    div.innerHTML = `<span class="seat-name">${p ? p.name : 'Aguardando...'}</span>`;
    seats.appendChild(div);
  }
}

const TEAM_LABEL = ['🔵 Dupla 1', '🔴 Dupla 2'];
const TEAM_CLASS  = ['team0',     'team1'];

export function renderReadyScreen(players) {
  const list = document.getElementById('ready-players-list');
  if (!list || !players) return;
  list.innerHTML = '';

  // Group by team: [team0 players, team1 players]
  const byTeam = [[], []];
  players.forEach((p, i) => {
    if (p?.teamIndex === 0 || p?.teamIndex === 1) byTeam[p.teamIndex].push({ p, i });
  });

  byTeam.forEach((members, t) => {
    if (members.length === 0) return;

    // Team header
    const header = document.createElement('div');
    header.className = `ready-team-header ${TEAM_CLASS[t]}`;
    header.textContent = TEAM_LABEL[t];
    list.appendChild(header);

    members.forEach(({ p, i }) => {
      const isReady = state.readyPlayers.has(i);
      const isMe = i === state.mySeatIndex;
      const row = document.createElement('div');
      row.className = `ready-player-row${isReady ? ' is-ready' : ''}`;
      row.innerHTML = `
        <span class="rp-name${isMe ? ' me' : ''}">${p.name}${isMe ? ' (você)' : ''}</span>
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

document.getElementById('btn-ready').addEventListener('click', () => {
  if (state.iAmReady) return;
  state.iAmReady = true;
  socket.emit('playerReady', {}, (res) => {
    if (!res.ok) { showToast(res.msg, 'error'); state.iAmReady = false; return; }
    state.readyPlayers.add(state.mySeatIndex);
    if (state.gameState) renderReadyScreen(state.gameState.players);
  });
});
