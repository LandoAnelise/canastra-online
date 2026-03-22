import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, closeModal } from '../utils.js';
import { clearSelection } from './render.js';

export function showRoundModal(result) {
  if (result.gameOver) return; // game over modal handles it

  // Header
  document.getElementById('round-winner-badge').textContent =
    `🏆 ${result.winnerPlayerName} bateu! (Dupla ${result.winningTeam + 1})`;
  document.getElementById('round-modal-number').textContent = `Rodada ${result.round}`;

  // Per-team breakdown
  for (let t = 0; t < 2; t++) {
    const d = result.teamMeldDetails[t];
    const isWinner = t === result.winningTeam;
    const col = document.getElementById(`round-team-col-${t}`);
    col.className = `round-team-col ${isWinner ? 'winner' : 'loser'}`;

    document.getElementById(`round-team-name-${t}`).textContent =
      `Dupla ${t+1}${isWinner ? ' 🏆' : ''}`;

    // Breakdown lines
    const bd = document.getElementById(`round-breakdown-${t}`);
    const sign = v => v > 0 ? `+${v}` : `${v}`;
    bd.innerHTML = `
      <div class="breakdown-line">
        <span class="bl-label">Cartas na mesa</span>
        <span class="bl-val positive">+${d.cardsPoints}</span>
      </div>
      ${d.canastrasLimpas > 0 ? `<div class="breakdown-line">
        <span class="bl-label">Canastra${d.canastrasLimpas>1?'s':''} limpa${d.canastrasLimpas>1?'s':''} ×${d.canastrasLimpas}</span>
        <span class="bl-val bonus">+${d.canastrasLimpas * 200}</span>
      </div>` : ''}
      ${d.canastrasSujas > 0 ? `<div class="breakdown-line">
        <span class="bl-label">Canastra${d.canastrasSujas>1?'s':''} suja${d.canastrasSujas>1?'s':''} ×${d.canastrasSujas}</span>
        <span class="bl-val bonus">+${d.canastrasSujas * 100}</span>
      </div>` : ''}
      ${d.baterBonus > 0 ? `<div class="breakdown-line">
        <span class="bl-label">Bônus bater</span>
        <span class="bl-val bonus">+${d.baterBonus}</span>
      </div>` : ''}`;

    // Subtotal from melds
    const meldTotal = d.cardsPoints + d.canastrasBonus + d.baterBonus;

    // Hand losses for this team
    const teamLosses = result.playerHandLoss
      .filter(p => p.teamIndex === t && !p.isBatter && p.handPoints > 0);
    if (teamLosses.length > 0) {
      teamLosses.forEach(p => {
        bd.insertAdjacentHTML('beforeend', `
          <div class="breakdown-line">
            <span class="bl-label">Mão de ${p.playerName}</span>
            <span class="bl-val negative">−${p.handPoints}</span>
          </div>`);
      });
    }

    bd.insertAdjacentHTML('beforeend', '<hr class="breakdown-sep">');

    const roundPts = result.roundPoints[t];
    document.getElementById(`round-subtotal-${t}`).innerHTML = `
      <span style="opacity:0.6;font-size:0.72rem">Esta rodada</span>
      <span style="color:${roundPts>=0?'#6de89a':'#e74c3c'};font-weight:700">${roundPts>=0?'+':''}${roundPts}</span>`;

    document.getElementById(`round-total-${t}`).innerHTML = `
      <span class="total-label">Total geral</span>
      <span class="total-val">${result.scores[t]}</span>`;
  }

  // Player chips (who lost hand / who bateu)
  const losses = document.getElementById('round-hand-losses');
  losses.innerHTML = '<span style="font-size:0.7rem;opacity:0.4;margin-right:4px">Mãos:</span>';
  result.playerHandLoss.forEach(p => {
    const chip = p.isBatter
      ? `<span class="hand-loss-chip safe">✅ ${p.playerName} bateu</span>`
      : p.handPoints > 0
        ? `<span class="hand-loss-chip lost">${p.playerName} −${p.handPoints}</span>`
        : `<span class="hand-loss-chip safe">${p.playerName} mão vazia</span>`;
    losses.insertAdjacentHTML('beforeend', chip);
  });

  document.getElementById('modal-round').classList.remove('hidden');
}

document.getElementById('btn-continue-round').addEventListener('click', () => {
  closeModal('modal-round');
  socket.emit('continueRound', {}, res => {
    if (!res.ok) showToast(res.msg || 'Erro ao continuar.', 'error');
  });
});

export function showGameOverModal(gs) {
  const winner = gs.scores[0] >= 2000 ? 0 : 1;
  document.getElementById('modal-go-title').textContent = `Dupla ${winner + 1} venceu! 🎉`;
  document.getElementById('modal-go-body').innerHTML = `
    <div class="score-row winner"><span class="label">Dupla 1</span><span class="value">${gs.scores[0]} pts</span></div>
    <div class="score-row winner"><span class="label">Dupla 2</span><span class="value">${gs.scores[1]} pts</span></div>`;
  document.getElementById('modal-gameover').classList.remove('hidden');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('newGame', {}, res => {
    if (!res.ok) showToast(res.msg, 'error');
    else { closeModal('modal-gameover'); state.teamsInitialized = false; }
  });
});

// ─── PAUSE / RECONNECT ───────────────────────────────────────────────────────
let pauseCountdownInterval = null;

socket.on('gamePaused', ({ playerName, timeoutMs }) => {
  closeModal('modal-round'); // don't interrupt with round modal
  document.getElementById('paused-msg').textContent =
    `${playerName} desconectou. Aguardando reconexão…`;
  startPauseCountdown(timeoutMs);
  document.getElementById('modal-paused').classList.remove('hidden');
  showToast(`⏸ ${playerName} desconectou. Jogo pausado.`, 'error', 6000);
});

socket.on('gameResumed', ({ playerName }) => {
  stopPauseCountdown();
  closeModal('modal-paused');
  showToast(`▶ ${playerName} reconectou! Jogo retomado.`, 'success', 3000);
});

socket.on('playerAbandoned', ({ playerName }) => {
  stopPauseCountdown();
  document.getElementById('paused-msg').textContent =
    `${playerName} não reconectou a tempo. A partida foi encerrada.`;
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
    el.textContent = `${m}:${s}`;
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
