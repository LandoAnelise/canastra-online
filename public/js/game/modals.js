import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, closeModal, showScreen } from '../utils.js';
import { clearSelection } from './render.js';
import { playWin, playLose, playChime } from '../sounds.js';
import { clearSession } from '../session.js';

export function showRoundModal(result) {
  if (result.gameOver) { showGameOverModal(result); return; }

  playChime();

  // Header
  const winnerTeamName = (result.teamNames && result.teamNames[result.winningTeam]) || ('Dupla ' + (result.winningTeam + 1));
  document.getElementById('round-winner-badge').textContent =
    result.winnerPlayerName + ' bateu! (' + winnerTeamName + ')';
  document.getElementById('round-modal-number').textContent = 'Rodada ' + result.round;

  // Per-team breakdown
  for (let t = 0; t < 2; t++) {
    const d = result.teamMeldDetails[t];
    const col = document.getElementById('round-team-col-' + t);
    col.className = 'round-team-col';

    const teamName = (result.teamNames && result.teamNames[t]) || ('Dupla ' + (t + 1));
    document.getElementById('round-team-name-' + t).textContent = teamName;

    // Breakdown lines
    const bd = document.getElementById('round-breakdown-' + t);
    const sign = v => v > 0 ? '+' + v : '' + v;
    bd.innerHTML =
      '<div class="breakdown-line">' +
        '<span class="bl-label">Cartas na mesa</span>' +
        '<span class="bl-val positive">+' + d.cardsPoints + '</span>' +
      '</div>' +
      (d.canastrasLimpas > 0 ?
        '<div class="breakdown-line">' +
          '<span class="bl-label">Canastra' + (d.canastrasLimpas > 1 ? 's' : '') + ' limpa' + (d.canastrasLimpas > 1 ? 's' : '') + ' \xd7' + d.canastrasLimpas + '</span>' +
          '<span class="bl-val bonus">+' + (d.canastrasLimpas * 200) + '</span>' +
        '</div>' : '') +
      (d.canastrasSujas > 0 ?
        '<div class="breakdown-line">' +
          '<span class="bl-label">Canastra' + (d.canastrasSujas > 1 ? 's' : '') + ' suja' + (d.canastrasSujas > 1 ? 's' : '') + ' \xd7' + d.canastrasSujas + '</span>' +
          '<span class="bl-val bonus">+' + (d.canastrasSujas * 100) + '</span>' +
        '</div>' : '') +
      (d.baterBonus > 0 ?
        '<div class="breakdown-line">' +
          '<span class="bl-label">' + (d.baterBonus >= 100 ? 'Batida limpa' : 'B\xf4nus bater') + '</span>' +
          '<span class="bl-val bonus">+' + d.baterBonus + '</span>' +
        '</div>' : '');

    // Hand losses for this team
    const teamLosses = result.playerHandLoss
      .filter(p => p.teamIndex === t && !p.isBatter && p.handPoints > 0);
    if (teamLosses.length > 0) {
      teamLosses.forEach(p => {
        bd.insertAdjacentHTML('beforeend',
          '<div class="breakdown-line">' +
            '<span class="bl-label">M\xe3o de ' + p.playerName + '</span>' +
            '<span class="bl-val negative">\u2212' + p.handPoints + '</span>' +
          '</div>');
      });
    }

    bd.insertAdjacentHTML('beforeend', '<hr class="breakdown-sep">');

    const roundPts = result.roundPoints[t];
    document.getElementById('round-subtotal-' + t).innerHTML =
      '<span style="opacity:0.6;font-size:0.72rem">Esta rodada</span>' +
      '<span style="color:' + (roundPts >= 0 ? '#6de89a' : '#e74c3c') + ';font-weight:700">' + (roundPts >= 0 ? '+' : '') + roundPts + '</span>';

    document.getElementById('round-total-' + t).innerHTML =
      '<span class="total-label">Total geral</span>' +
      '<span class="total-val">' + result.scores[t] + '</span>';
  }

  // Player chips (who lost hand / who bateu)
  const losses = document.getElementById('round-hand-losses');
  losses.innerHTML = '<span style="font-size:0.7rem;opacity:0.4;margin-right:4px">M\xe3os:</span>';
  result.playerHandLoss.forEach(p => {
    const chip = p.isBatter
      ? '<span class="hand-loss-chip safe">\u2705 ' + p.playerName + ' bateu</span>'
      : p.handPoints > 0
        ? '<span class="hand-loss-chip lost">' + p.playerName + ' \u2212' + p.handPoints + '</span>'
        : '<span class="hand-loss-chip safe">' + p.playerName + ' m\xe3o vazia</span>';
    losses.insertAdjacentHTML('beforeend', chip);
  });

  const isLeader = !!state.gameState?.isLeader;
  const btnContinue = document.getElementById('btn-continue-round');
  btnContinue.classList.toggle('hidden', !isLeader);
  document.getElementById('round-waiting-leader').classList.toggle('hidden', isLeader);

  document.getElementById('modal-round').classList.remove('hidden');
}

document.getElementById('btn-continue-round').addEventListener('click', () => {
  closeModal('modal-round');
  socket.emit('continueRound', {}, res => {
    if (!res.ok) showToast(res.msg || 'Erro ao continuar.', 'error');
  });
});

export function showGameOverModal(result) {
  const winner = result.winnerTeam ?? (result.scores[0] >= 2000 ? 0 : 1);
  const tNames = result.teamNames || ['Dupla 1', 'Dupla 2'];
  const hasBreakdown = Array.isArray(result.teamMeldDetails);

  if ((result.myTeam ?? state.gameState?.myTeam) === winner) playWin(); else playLose();

  document.getElementById('modal-go-title').textContent = tNames[winner] + ' venceram! 🎉';

  // Per-team breakdown (reuse same logic as round modal)
  for (let t = 0; t < 2; t++) {
    const d = hasBreakdown ? result.teamMeldDetails[t] : null;
    document.getElementById('go-team-name-' + t).textContent = tNames[t];

    const col = document.getElementById('go-team-col-' + t);
    col.className = 'round-team-col' + (t === winner ? ' winner' : ' loser');

    const bd = document.getElementById('go-breakdown-' + t);
    if (d) {
      bd.innerHTML =
        '<div class="breakdown-line">' +
          '<span class="bl-label">Cartas na mesa</span>' +
          '<span class="bl-val positive">+' + d.cardsPoints + '</span>' +
        '</div>' +
        (d.canastrasLimpas > 0 ?
          '<div class="breakdown-line">' +
            '<span class="bl-label">Canastra' + (d.canastrasLimpas > 1 ? 's' : '') + ' limpa' + (d.canastrasLimpas > 1 ? 's' : '') + ' \xd7' + d.canastrasLimpas + '</span>' +
            '<span class="bl-val bonus">+' + (d.canastrasLimpas * 200) + '</span>' +
          '</div>' : '') +
        (d.canastrasSujas > 0 ?
          '<div class="breakdown-line">' +
            '<span class="bl-label">Canastra' + (d.canastrasSujas > 1 ? 's' : '') + ' suja' + (d.canastrasSujas > 1 ? 's' : '') + ' \xd7' + d.canastrasSujas + '</span>' +
            '<span class="bl-val bonus">+' + (d.canastrasSujas * 100) + '</span>' +
          '</div>' : '') +
        (d.baterBonus > 0 ?
          '<div class="breakdown-line">' +
            '<span class="bl-label">' + (d.baterBonus >= 100 ? 'Batida limpa' : 'B\xf4nus bater') + '</span>' +
            '<span class="bl-val bonus">+' + d.baterBonus + '</span>' +
          '</div>' : '');

      const teamLosses = (result.playerHandLoss || [])
        .filter(p => p.teamIndex === t && !p.isBatter && p.handPoints > 0);
      teamLosses.forEach(p => {
        bd.insertAdjacentHTML('beforeend',
          '<div class="breakdown-line">' +
            '<span class="bl-label">M\xe3o de ' + p.playerName + '</span>' +
            '<span class="bl-val negative">\u2212' + p.handPoints + '</span>' +
          '</div>');
      });

      bd.insertAdjacentHTML('beforeend', '<hr class="breakdown-sep">');

      const roundPts = result.roundPoints[t];
      document.getElementById('go-subtotal-' + t).innerHTML =
        '<span style="opacity:0.6;font-size:0.72rem">Esta rodada</span>' +
        '<span style="color:' + (roundPts >= 0 ? '#6de89a' : '#e74c3c') + ';font-weight:700">' + (roundPts >= 0 ? '+' : '') + roundPts + '</span>';
    } else {
      bd.innerHTML = '';
      document.getElementById('go-subtotal-' + t).innerHTML = '';
    }

    document.getElementById('go-total-' + t).innerHTML =
      '<span class="total-label">Total geral</span>' +
      '<span class="total-val">' + result.scores[t] + '</span>';
  }

  // Player chips
  const losses = document.getElementById('go-hand-losses');
  losses.innerHTML = '';
  if (result.playerHandLoss?.length) {
    losses.innerHTML = '<span style="font-size:0.7rem;opacity:0.4;margin-right:4px">M\xe3os:</span>';
    result.playerHandLoss.forEach(p => {
      const chip = p.isBatter
        ? '<span class="hand-loss-chip safe">\u2705 ' + p.playerName + ' bateu</span>'
        : p.handPoints > 0
          ? '<span class="hand-loss-chip lost">' + p.playerName + ' \u2212' + p.handPoints + '</span>'
          : '<span class="hand-loss-chip safe">' + p.playerName + ' m\xe3o vazia</span>';
      losses.insertAdjacentHTML('beforeend', chip);
    });
  }

  document.getElementById('modal-gameover').classList.remove('hidden');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  closeModal('modal-gameover');
  clearSession();
  state.teamsInitialized = false;
  state.gameState = null;
  state.myRoomId = null;
  history.replaceState(null, '', '/');
  showScreen('screen-lobby');
});

// ─── PAUSE / RECONNECT ───────────────────────────────────────────────────────
let pauseCountdownInterval = null;

socket.on('gamePaused', ({ playerName, timeoutMs }) => {
  closeModal('modal-round'); // don't interrupt with round modal
  document.getElementById('paused-msg').textContent =
    playerName + ' desconectou. Aguardando reconex\xe3o\u2026';
  startPauseCountdown(timeoutMs);
  document.getElementById('modal-paused').classList.remove('hidden');
  showToast('\u23f8 ' + playerName + ' desconectou. Jogo pausado.', 'error', 6000);
});

socket.on('gameResumed', ({ playerName }) => {
  stopPauseCountdown();
  closeModal('modal-paused');
  showToast('\u25b6 ' + playerName + ' reconectou! Jogo retomado.', 'success', 1000);
});

socket.on('playerAbandoned', ({ playerName }) => {
  stopPauseCountdown();
  document.getElementById('paused-msg').textContent =
    playerName + ' n\xe3o reconectou a tempo. A partida foi encerrada.';
  document.getElementById('paused-timer').textContent = '';
});

function startPauseCountdown(ms) {
  stopPauseCountdown();
  let remaining = ms;
  const el = document.getElementById('paused-timer');
  function tick() {
    if (remaining <= 0) { el.textContent = '00:00'; return; }
    const m = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const s = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    el.textContent = m + ':' + s;
    remaining -= 1000;
  }
  tick();
  pauseCountdownInterval = setInterval(tick, 1000);
}

function stopPauseCountdown() {
  clearInterval(pauseCountdownInterval);
  pauseCountdownInterval = null;
}

// ─── RULES MODAL ─────────────────────────────────────────────────────────────
document.getElementById('btn-show-rules').addEventListener('click', () => {
  document.getElementById('modal-rules').classList.remove('hidden');
});
document.getElementById('btn-close-rules').addEventListener('click', () => {
  closeModal('modal-rules');
});
// Close rules modal clicking backdrop
document.getElementById('modal-rules').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-rules')) closeModal('modal-rules');
});
