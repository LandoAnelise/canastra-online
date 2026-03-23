import socket from '../socket.js';
import { state } from '../state.js';
import { showToast } from '../utils.js';

// Ordered seatIndex arrays per team — determines who plays 1st vs 2nd within each team
const teamOrders = { 0: [], 1: [] };

export function renderTeamSelection(gs) {
  state.amLeader = !!gs.isLeader;

  const notice = document.getElementById('teams-leader-notice');
  if (notice) {
    notice.textContent = state.amLeader
      ? '👑 Você é o líder — arraste os jogadores para montar as duplas e defina a ordem'
      : `👑 Aguardando ${gs.players[0]?.name || 'o líder'} montar as duplas…`;
    notice.className = state.amLeader ? 'teams-leader-notice leader' : 'teams-leader-notice';
  }
  document.getElementById('btn-confirm-teams').style.display = state.amLeader ? '' : 'none';

  if (state.teamsInitialized) { updateTeamChips(gs, state.amLeader); return; }
  state.teamsInitialized = true;
  state.teamAssignments = {};
  teamOrders[0] = [];
  teamOrders[1] = [];
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
        // Remove from previous team order
        const prevTeam = state.teamAssignments[state.dragSeat];
        if (prevTeam !== -1) teamOrders[prevTeam] = teamOrders[prevTeam].filter(s => s !== state.dragSeat);
        // Add to new team order
        if (targetTeam !== -1) teamOrders[targetTeam].push(state.dragSeat);
        state.teamAssignments[state.dragSeat] = targetTeam;
        updateTeamChips(gs, state.amLeader);
        updateConfirmBtn();
      });
    });
  }

  updateTeamChips(gs, state.amLeader);
}

function moveInTeam(gs, teamIdx, seatIdx, direction) {
  const order = teamOrders[teamIdx];
  const pos = order.indexOf(seatIdx);
  const newPos = pos + direction;
  if (newPos < 0 || newPos >= order.length) return;
  order.splice(pos, 1);
  order.splice(newPos, 0, seatIdx);
  updateTeamChips(gs, true);
}

function updateTeamChips(gs, isLeader = false) {
  const slots = {
    '-1': document.getElementById('unassigned-slots'),
    '0':  document.getElementById('team0-slots'),
    '1':  document.getElementById('team1-slots'),
  };
  Object.values(slots).forEach(s => s.innerHTML = '');

  // Unassigned players
  gs.players.forEach((p, i) => {
    if ((state.teamAssignments[i] ?? -1) !== -1) return;
    const isMe = i === state.mySeatIndex;
    const chip = document.createElement('div');
    chip.className = `player-chip${isMe ? ' me-chip' : ''}`;
    chip.draggable = isLeader;
    chip.dataset.seat = i;
    chip.innerHTML = `<div class="chip-avatar">${p.name.slice(0,2).toUpperCase()}</div>
      <span>${p.name}${isMe ? ' (você)' : ''}</span>`;
    if (isLeader) attachDragHandlers(chip, i);
    slots['-1'].appendChild(chip);
  });

  // Team players — rendered in teamOrders order
  [0, 1].forEach(t => {
    const order = teamOrders[t];
    order.forEach((seatIdx, pos) => {
      const p = gs.players[seatIdx];
      if (!p) return;
      const isMe = seatIdx === state.mySeatIndex;
      const chip = document.createElement('div');
      chip.className = `player-chip${isMe ? ' me-chip' : ''}`;
      chip.draggable = isLeader;
      chip.dataset.seat = seatIdx;

      const posLabel = pos === 0 ? '1º' : '2º';
      const orderControls = isLeader ? `
        <div class="chip-order-controls">
          <button class="btn-chip-move" data-dir="-1" ${pos === 0 ? 'disabled' : ''} title="Subir">▲</button>
          <button class="btn-chip-move" data-dir="1"  ${pos === order.length - 1 ? 'disabled' : ''} title="Descer">▼</button>
        </div>` : '';

      chip.innerHTML = `<span class="chip-pos">${posLabel}</span>
        <div class="chip-avatar">${p.name.slice(0,2).toUpperCase()}</div>
        <span class="chip-name">${p.name}${isMe ? ' (você)' : ''}</span>
        ${orderControls}`;

      if (isLeader) {
        attachDragHandlers(chip, seatIdx);
        chip.querySelectorAll('.btn-chip-move').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            moveInTeam(gs, t, seatIdx, parseInt(btn.dataset.dir));
            updateConfirmBtn();
          });
        });
      }
      slots[String(t)].appendChild(chip);
    });
  });
}

function attachDragHandlers(chip, seatIdx) {
  chip.addEventListener('dragstart', () => {
    state.dragSeat = seatIdx;
    setTimeout(() => chip.classList.add('dragging'), 0);
  });
  chip.addEventListener('dragend', () => {
    chip.classList.remove('dragging');
    state.dragSeat = null;
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
  socket.emit('assignTeams', { teams, teamOrders }, (res) => {
    if (!res.ok) showToast(res.msg, 'error');
  });
});
