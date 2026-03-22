import socket from '../socket.js';
import { state } from '../state.js';
import { showToast } from '../utils.js';

export function renderTeamSelection(gs) {
  state.amLeader = !!gs.isLeader;

  // Update leader notice
  const notice = document.getElementById('teams-leader-notice');
  if (notice) {
    notice.textContent = state.amLeader
      ? '👑 Você é o líder — arraste os jogadores para montar as duplas'
      : `👑 Aguardando ${gs.players[0]?.name || 'o líder'} montar as duplas…`;
    notice.className = state.amLeader ? 'teams-leader-notice leader' : 'teams-leader-notice';
  }
  document.getElementById('btn-confirm-teams').style.display = state.amLeader ? '' : 'none';

  if (state.teamsInitialized) { updateTeamChips(gs, state.amLeader); return; }
  state.teamsInitialized = true;
  state.teamAssignments = {};
  gs.players.forEach((_, i) => { state.teamAssignments[i] = -1; });

  if (state.amLeader) {
    ['unassigned-slots', 'team0-slots', 'team1-slots'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (state.dragSeat === null) return;
        const targetTeam = id === 'team0-slots' ? 0 : id === 'team1-slots' ? 1 : -1;
        if (targetTeam !== -1) {
          const inTeam = Object.values(state.teamAssignments).filter(t => t === targetTeam).length;
          if (inTeam >= 2) { showToast('Cada dupla só pode ter 2 jogadores.', 'error'); return; }
        }
        state.teamAssignments[state.dragSeat] = targetTeam;
        updateTeamChips(gs, state.amLeader);
        updateConfirmBtn();
      });
    });
  }

  updateTeamChips(gs, state.amLeader);
}

function updateTeamChips(gs, isLeader = false) {
  const slots = {
    '-1': document.getElementById('unassigned-slots'),
    '0':  document.getElementById('team0-slots'),
    '1':  document.getElementById('team1-slots'),
  };
  Object.values(slots).forEach(s => s.innerHTML = '');

  gs.players.forEach((p, i) => {
    const team = String(state.teamAssignments[i] ?? -1);
    const isMe = i === state.mySeatIndex;
    const chip = document.createElement('div');
    chip.className = `player-chip${isMe ? ' me-chip' : ''}`;
    chip.draggable = isLeader;
    chip.dataset.seat = i;
    chip.innerHTML = `<div class="chip-avatar">${p.name.slice(0,2).toUpperCase()}</div>
      <span>${p.name}${isMe ? ' (você)' : ''}</span>`;
    if (isLeader) {
      chip.addEventListener('dragstart', () => {
        state.dragSeat = i;
        setTimeout(() => chip.classList.add('dragging'), 0);
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        state.dragSeat = null;
      });
    }
    slots[team].appendChild(chip);
  });
}

function updateConfirmBtn() {
  const counts = [0, 1].map(t => Object.values(state.teamAssignments).filter(v => v === t).length);
  const ready = counts[0] === 2 && counts[1] === 2;
  document.getElementById('btn-confirm-teams').disabled = !ready;
  document.getElementById('teams-hint').textContent = ready
    ? 'Pronto! Confirme para iniciar.'
    : `Dupla 1: ${counts[0]}/2  ·  Dupla 2: ${counts[1]}/2`;
}

document.getElementById('btn-confirm-teams').addEventListener('click', () => {
  const teams = Object.entries(state.teamAssignments).map(([seat, team]) => ({
    seatIndex: parseInt(seat), teamIndex: team,
  }));
  socket.emit('assignTeams', { teams }, (res) => {
    if (!res.ok) showToast(res.msg, 'error');
  });
});
