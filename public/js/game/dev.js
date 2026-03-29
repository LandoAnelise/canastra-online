import socket from '../socket.js';
import { state } from '../state.js';
import { showToast } from '../utils.js';

// ── DEV PANEL ────────────────────────────────────────────────────────────────
// Só ativo em salas de teste (testMode = true no gameState)

const panel     = document.getElementById('dev-panel');
const toggle    = document.getElementById('dev-panel-toggle');
const body      = document.getElementById('dev-panel-body');
const inp0      = document.getElementById('dev-score-0');
const inp1      = document.getElementById('dev-score-1');
const btnApply  = document.getElementById('dev-apply-scores');
const cbHands   = document.getElementById('dev-show-hands');

// Mostra/oculta o painel conforme o gameState
socket.on('gameState', (gs) => {
  if (!gs.testMode) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  // Sincroniza inputs com os scores atuais (sem sobrescrever se o usuário estiver editando)
  if (document.activeElement !== inp0) inp0.value = gs.scores[0];
  if (document.activeElement !== inp1) inp1.value = gs.scores[1];

  // Atualiza mãos visíveis se "ver todas as mãos" estiver ativo
  if (cbHands.checked && gs.allHands) renderAllHands(gs);
});

toggle.addEventListener('click', () => body.classList.toggle('hidden'));

btnApply.addEventListener('click', () => {
  const s0 = parseInt(inp0.value) || 0;
  const s1 = parseInt(inp1.value) || 0;
  socket.emit('setTestScores', { s0, s1 }, (res) => {
    if (!res?.ok) showToast(res?.msg || 'Erro', 'error');
    else showToast(`Pontos ajustados: ${s0} / ${s1}`, 'success', 1500);
  });
});

// ── Ver todas as mãos ─────────────────────────────────────────────────────────
cbHands.addEventListener('change', () => {
  // Solicita atualização do estado para re-renderizar
  if (!cbHands.checked) clearAllHandOverlays();
});

function clearAllHandOverlays() {
  document.querySelectorAll('.dev-hand-overlay').forEach(el => el.remove());
}

function renderAllHands(gs) {
  clearAllHandOverlays();
  // Mapeia seat → posição visual (top, left, right, bottom=me)
  // myIndex é sempre 0 (único humano), mas os oponentes podem variar
  const positions = ['top', 'left', 'right']; // os 3 bots
  const botIndices = (gs.botSeats || []).slice(0, 3);

  botIndices.forEach((seatIdx, i) => {
    const hand = gs.allHands[seatIdx];
    if (!hand || hand.length === 0) return;
    const pos = positions[i];
    const container = document.getElementById(`hand-${pos}`);
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.className = 'dev-hand-overlay';
    hand.forEach(card => {
      const isRed = card.suit === '♥' || card.suit === '♦';
      const div = document.createElement('div');
      div.className = `dev-mini-card${isRed ? ' red' : ''}`;
      div.textContent = card.rank + card.suit;
      overlay.appendChild(div);
    });
    container.appendChild(overlay);
  });
}
