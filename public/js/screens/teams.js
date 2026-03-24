import socket from '../socket.js';
import { state } from '../state.js';
import { showToast } from '../utils.js';

// Ordered seatIndex arrays per team — determines who plays 1st vs 2nd within each team
const teamOrders = { 0: [], 1: [] };

// Ghost element for touch drag
let _ghost = null;
let _currentGs = null; // latest gs reference

export function renderTeamSelection(gs) {
  state.amLeader = !!gs.isLeader;
  _currentGs = gs;

  const leaderName = gs.players[0]?.name || 'o líder';
  const notice = document.getElementById('teams-leader-notice');
  if (notice) {
    notice.textContent = state.amLeader
      ? '👑 Você é o líder — arraste os jogadores para montar as duplas e defina a ordem'
      : `⏳ Aguardando ${leaderName} montar as duplas…`;
    notice.className = state.amLeader ? 'teams-leader-notice leader' : 'teams-leader-notice';
  }
  document.getElementById('btn-confirm-teams').style.display = state.amLeader ? '' : 'none';
  document.getElementById('teams-grid').style.display        = state.amLeader ? '' : 'none';
  document.getElementById('teams-hint').style.display        = state.amLeader ? '' : 'none';

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
        performDrop(id, gs);
      });
    });
  }

  updateTeamChips(gs, state.amLeader);
}

// Apply a draft broadcasted from the leader
export function applyTeamDraft({ assignments, teamOrders: to }) {
  if (!_currentGs || state.amLeader) return;
  state.teamAssignments = assignments;
  teamOrders[0] = to[0] ?? [];
  teamOrders[1] = to[1] ?? [];
  updateTeamChips(_currentGs, false);
}

function broadcastDraft() {
  if (!state.amLeader) return;
  socket.emit('teamDraftChanged', {
    assignments: { ...state.teamAssignments },
    teamOrders: { 0: [...teamOrders[0]], 1: [...teamOrders[1]] },
  });
}

function performDrop(targetId, gs) {
  const targetTeam = targetId === 'team0-slots' ? 0 : targetId === 'team1-slots' ? 1 : -1;
  if (targetTeam !== -1) {
    const inTeam = Object.values(state.teamAssignments).filter(t => t === targetTeam).length;
    if (inTeam >= 2) { showToast('Cada dupla só pode ter 2 jogadores.', 'error'); return; }
  }
  const prevTeam = state.teamAssignments[state.dragSeat];
  if (prevTeam !== -1) teamOrders[prevTeam] = teamOrders[prevTeam].filter(s => s !== state.dragSeat);
  if (targetTeam !== -1) teamOrders[targetTeam].push(state.dragSeat);
  state.teamAssignments[state.dragSeat] = targetTeam;
  updateTeamChips(gs, state.amLeader);
  updateConfirmBtn();
  broadcastDraft();
}

function moveInTeam(gs, teamIdx, seatIdx, direction) {
  const order = teamOrders[teamIdx];
  const pos = order.indexOf(seatIdx);
  const newPos = pos + direction;
  if (newPos < 0 || newPos >= order.length) return;
  order.splice(pos, 1);
  order.splice(newPos, 0, seatIdx);
  updateTeamChips(gs, true);
  updateConfirmBtn();
  broadcastDraft();
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
    if (isLeader) attachDragHandlers(chip, i, gs);
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
        attachDragHandlers(chip, seatIdx, gs);
        chip.querySelectorAll('.btn-chip-move').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            moveInTeam(gs, t, seatIdx, parseInt(btn.dataset.dir));
          });
        });
      }
      slots[String(t)].appendChild(chip);
    });
  });
}

// ── Drop zone IDs for touch hit-testing ──────────────────────────────────────
const ZONE_IDS = ['unassigned-slots', 'team0-slots', 'team1-slots'];

function getDropZoneIdAt(x, y) {
  if (_ghost) _ghost.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  if (_ghost) _ghost.style.display = '';
  if (!el) return null;
  for (const id of ZONE_IDS) {
    const zone = document.getElementById(id);
    if (zone && zone.contains(el)) return id;
  }
  return null;
}

function removeGhost() {
  if (_ghost) { _ghost.remove(); _ghost = null; }
  ZONE_IDS.forEach(id => document.getElementById(id)?.classList.remove('drag-over'));
}

function attachDragHandlers(chip, seatIdx, gs) {
  // ── HTML5 drag (desktop) ──────────────────────────────────────
  chip.addEventListener('dragstart', () => {
    state.dragSeat = seatIdx;
    setTimeout(() => chip.classList.add('dragging'), 0);
  });
  chip.addEventListener('dragend', () => {
    chip.classList.remove('dragging');
    state.dragSeat = null;
  });

  // ── Touch drag (mobile) ───────────────────────────────────────
  chip.addEventListener('touchstart', e => {
    if (e.target.closest('.btn-chip-move')) return;
    e.stopPropagation();

    state.dragSeat = seatIdx;
    chip.classList.add('dragging');

    const touch = e.touches[0];
    const rect = chip.getBoundingClientRect();

    _ghost = chip.cloneNode(true);
    _ghost.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      pointer-events: none;
      opacity: 0.85;
      z-index: 9999;
      transform: scale(1.08);
      transition: none;
    `;
    _ghost.querySelectorAll('.chip-order-controls').forEach(el => el.remove());
    document.body.appendChild(_ghost);

    chip._touchOffsetX = touch.clientX - rect.left;
    chip._touchOffsetY = touch.clientY - rect.top;
  }, { passive: true });

  chip.addEventListener('touchmove', e => {
    if (!_ghost || state.dragSeat !== seatIdx) return;
    e.preventDefault();

    const touch = e.touches[0];
    _ghost.style.left = `${touch.clientX - chip._touchOffsetX}px`;
    _ghost.style.top  = `${touch.clientY - chip._touchOffsetY}px`;

    ZONE_IDS.forEach(id => document.getElementById(id)?.classList.remove('drag-over'));
    const zoneId = getDropZoneIdAt(touch.clientX, touch.clientY);
    if (zoneId) document.getElementById(zoneId)?.classList.add('drag-over');
  }, { passive: false });

  chip.addEventListener('touchend', e => {
    if (state.dragSeat !== seatIdx) return;
    const touch = e.changedTouches[0];
    const zoneId = getDropZoneIdAt(touch.clientX, touch.clientY);

    chip.classList.remove('dragging');
    removeGhost();

    if (zoneId) performDrop(zoneId, gs);
    state.dragSeat = null;
  });

  chip.addEventListener('touchcancel', () => {
    chip.classList.remove('dragging');
    removeGhost();
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
