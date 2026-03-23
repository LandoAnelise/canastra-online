import socket from '../socket.js';
import { state } from '../state.js';
import { autoSortHand, isRed, isWild, cardHTML, discardCardHTML, isCanastraLimpa, isCanastraSuja, showToast } from '../utils.js';

// ─── HAND REORDER DRAG-AND-DROP ───────────────────────────────────────────────
let dragCardId = null;

export function getDragCardId() { return dragCardId; }

export function renderGame(gs) {
  if (!gs) return;

  // Sync hand order — auto-sort when starting fresh, otherwise preserve custom order
  const handIds = gs.myHand.map(c => c.id);
  if (state.myHandOrder.length === 0) {
    // New round or first load — apply auto-sort
    state.myHandOrder = autoSortHand(gs.myHand).map(c => c.id);
  } else {
    // Keep custom order, append any new cards (drawn/taken) at end
    state.myHandOrder = state.myHandOrder.filter(id => handIds.includes(id));
    handIds.forEach(id => { if (!state.myHandOrder.includes(id)) state.myHandOrder.push(id); });
  }

  document.getElementById('val-score-0').textContent = gs.scores[0];
  document.getElementById('val-score-1').textContent = gs.scores[1];
  if (gs.teamNames) {
    document.getElementById('score-label-0').textContent = gs.teamNames[0];
    document.getElementById('score-label-1').textContent = gs.teamNames[1];
  }
  document.getElementById('game-status-label').textContent = `Rodada ${gs.round}`;

  const seats = getRelativeSeats(gs);
  renderOpponent('top',   seats.top,   gs);
  renderOpponent('left',  seats.left,  gs);
  renderOpponent('right', seats.right, gs);
  renderMe(gs);

  document.getElementById('deck-count').textContent = `${gs.deckSize} cartas`;
  document.getElementById('discard-count').textContent = `${gs.discardSize} no lixo`;
  document.getElementById('discard-pile').querySelector('.pile-card')?.remove();
  document.getElementById('discard-pile').querySelector('.pile-count')
    .insertAdjacentHTML('beforebegin', discardCardHTML(gs.discardTop));

  renderMelds(gs);

  const isMyTurn = gs.currentPlayerIndex === state.mySeatIndex;
  const currentName = gs.players[gs.currentPlayerIndex]?.name || '?';
  const turnBanner = document.getElementById('turn-banner');
  turnBanner.textContent = isMyTurn ? '🎯 Sua vez!' : `Vez de ${currentName}`;
  turnBanner.classList.remove('hidden');

  document.querySelectorAll('.player-slot').forEach(s => s.classList.remove('active-turn'));
  const slot = getSlotForSeat(gs.currentPlayerIndex, gs);
  if (slot) document.getElementById(`player-${slot}`)?.classList.add('active-turn');

  updateButtons(gs);
  if (gs.status === 'finished') {
    // Import lazily to avoid circular dependency
    import('./modals.js').then(m => m.showGameOverModal(gs));
  }
}

function getRelativeSeats(gs) {
  const me = state.mySeatIndex;
  const myTeam = gs.myTeam;

  // Teammate goes opposite (top); opponents fill right/left in clockwise order
  if (myTeam !== undefined && myTeam !== null) {
    const teammate = gs.players.findIndex((p, i) => i !== me && p?.teamIndex === myTeam);
    if (teammate !== -1) {
      const opponents = [];
      for (let i = 1; i <= 3; i++) {
        const seat = (me + i) % 4;
        if (seat !== teammate) opponents.push(seat);
      }
      return { top: teammate, right: opponents[0], left: opponents[1] };
    }
  }

  // Fallback: seat order
  return { right: (me+1)%4, top: (me+2)%4, left: (me+3)%4 };
}

function getSlotForSeat(idx, gs) {
  const s = getRelativeSeats(gs);
  if (idx === state.mySeatIndex) return 'bottom';
  if (idx === s.top)   return 'top';
  if (idx === s.left)  return 'left';
  if (idx === s.right) return 'right';
  return null;
}

function renderOpponent(pos, seatIdx, gs) {
  const p = gs.players[seatIdx];
  document.getElementById(`name-${pos}`).textContent = p?.name || '—';
  document.getElementById(`count-${pos}`).textContent = `${gs.handSizes[seatIdx] || 0} cartas`;
  const fan = document.getElementById(`hand-${pos}`);
  if (fan) {
    fan.innerHTML = '';
    for (let i = 0; i < Math.min(gs.handSizes[seatIdx]||0, 13); i++)
      fan.insertAdjacentHTML('beforeend', '<div class="back-card"></div>');
  }
}

export function renderMe(gs) {
  document.getElementById('name-me').textContent = gs.players[state.mySeatIndex]?.name || 'Você';
  document.getElementById('count-me').textContent = `${gs.myHand.length} cartas`;

  const hand = document.getElementById('my-hand');
  hand.innerHTML = '';
  // Detect newly drawn cards
  if (window._prevHandIds) {
    const newIds = gs.myHand.map(c => c.id).filter(id => !window._prevHandIds.has(id));
    if (newIds.length > 0) {
      state.justDrawnCardId = newIds[0]; // highlight first new card
      window._prevHandIds = null;
      setTimeout(() => { state.justDrawnCardId = null; }, 2500);
    }
  }

  const ordered = state.myHandOrder.map(id => gs.myHand.find(c => c.id === id)).filter(Boolean);
  ordered.forEach(card => {
    const sel = state.selectedCards.includes(card.id) ? 'selected' : '';
    const drawn = card.id === state.justDrawnCardId ? 'just-drawn' : '';
    hand.insertAdjacentHTML('beforeend', cardHTML(card, `${sel} ${drawn}`));
  });

  hand.querySelectorAll('.my-card').forEach(el => {
    el.addEventListener('click', () => onCardClick(el.dataset.id));
  });

  setupHandDragDrop(hand);
}

export function renderMelds(gs) {
  const isMyTurn = gs.currentPlayerIndex === state.mySeatIndex;
  const drawn    = gs.drawnThisTurn;

  // Update team labels — highlight the player's own team
  for (let t = 0; t < 2; t++) {
    const label    = document.getElementById(`melds-label-${t}`);
    const youBadge = label?.querySelector('.melds-label-you');
    const group    = document.getElementById(`melds-team${t}`);
    if (gs.teamNames) {
      document.getElementById(`melds-label-text-${t}`).textContent = gs.teamNames[t];
    }
    if (t === gs.myTeam) {
      group?.classList.add('my-team');
      youBadge?.classList.remove('hidden');
    } else {
      group?.classList.remove('my-team');
      youBadge?.classList.add('hidden');
    }
  }

  for (let t = 0; t < 2; t++) {
    const list = document.getElementById(`melds-list-${t}`);
    list.innerHTML = '';

    if (gs.melds[t].length === 0) {
      list.innerHTML = '<span class="melds-empty">Nenhum grupo ainda</span>';
      continue;
    }

    gs.melds[t].forEach((meld, mi) => {
      const isLimpa = isCanastraLimpa(meld);
      const isSuja  = isCanastraSuja(meld);
      const cls = isLimpa ? 'canastra-limpa' : isSuja ? 'canastra-suja' : '';
      const badge = isLimpa ? '<span class="canastra-badge limpa">✦ Limpa</span>'
                  : isSuja  ? '<span class="canastra-badge suja">✦ Suja</span>' : '';
      const typeLabel = meld.type === 'sequence' ? 'Sequência' : 'Grupo';
      const canAdd = isMyTurn && drawn && t === gs.myTeam;

      const el = document.createElement('div');
      el.className = `meld-group-full ${cls}`;
      el.innerHTML = `
        <div class="meld-header">
          <span class="meld-type-label">${typeLabel} ${meld.cards.length} cartas</span>
          ${badge}
          ${canAdd ? `<button class="btn-add-to-meld" data-team="${t}" data-index="${mi}">+ Adicionar</button>` : ''}
        </div>
        <div class="meld-cards-row">${meld.cards.map(fullCardHTML).join('')}</div>`;

      // Add button handler + drag-to-meld
      if (canAdd) {
        el.querySelector('.btn-add-to-meld').addEventListener('click', () => {
          if (state.selectedCards.length === 0) { showToast('Selecione cartas na mão primeiro.', 'error'); return; }
          const meldActions = [{ type: 'add', meldIndex: mi, cards: [...state.selectedCards] }];
          socket.emit('playMelds', { meldActions }, res => {
            if (!res.ok) { showToast(res.msg, 'error'); return; }
            showToast('Cartas adicionadas!', 'success');
            clearSelection();
          });
        });

        // Drag a card from hand directly onto this meld
        el.addEventListener('dragover', e => {
          if (!dragCardId) return;
          e.preventDefault();
          el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', e => {
          e.preventDefault();
          el.classList.remove('drop-target');
          if (!dragCardId) return;
          socket.emit('playMelds', { meldActions: [{ type: 'add', meldIndex: mi, cards: [dragCardId] }] }, res => {
            if (!res.ok) { showToast(res.msg, 'error'); return; }
            showToast('Carta adicionada!', 'success', 1400);
            clearSelection();
          });
        });
      }

      list.appendChild(el);
    });
  }
}

export function updateButtons(gs) {
  const isMyTurn = gs.currentPlayerIndex === state.mySeatIndex;
  const drawn = gs.drawnThisTurn;
  const hasCanastra = gs.melds[gs.myTeam]?.some(m => m.cards.length >= 7);
  const showBater = isMyTurn && drawn && hasCanastra && gs.myHand.length === 1;
  document.getElementById('btn-draw').disabled          = !isMyTurn || drawn;
  document.getElementById('btn-take-discard').disabled  = !isMyTurn || drawn || !gs.discardTop;
  document.getElementById('btn-play-melds').disabled    = !isMyTurn || !drawn || state.selectedCards.length === 0;
  document.getElementById('btn-discard').disabled       = !isMyTurn || !drawn;
  document.getElementById('btn-bater').classList.toggle('hidden', !showBater);
  document.getElementById('btn-bater').disabled         = !showBater;
}

export function onCardClick(cardId) {
  if (!state.gameState || state.gameState.currentPlayerIndex !== state.mySeatIndex || !state.gameState.drawnThisTurn) {
    showToast('Não é sua vez ou você ainda não comprou.', 'error'); return;
  }
  state.selectedCards = state.selectedCards.includes(cardId)
    ? state.selectedCards.filter(id => id !== cardId)
    : [...state.selectedCards, cardId];

  renderMe(state.gameState);
  updateButtons(state.gameState);
}

export function clearSelection() {
  state.selectedCards = [];
  if (state.gameState) renderMe(state.gameState);
  updateButtons(state.gameState);
}

function setupHandDragDrop(container) {
  container.querySelectorAll('.my-card').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragCardId = el.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.style.opacity = '0.35', 0);
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragCardId = null;
      container.querySelectorAll('.my-card').forEach(c => c.classList.remove('drag-over-card'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (dragCardId && dragCardId !== el.dataset.id) {
        container.querySelectorAll('.my-card').forEach(c => c.classList.remove('drag-over-card'));
        el.classList.add('drag-over-card');
      }
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragCardId || dragCardId === el.dataset.id) return;
      const from = state.myHandOrder.indexOf(dragCardId);
      const to   = state.myHandOrder.indexOf(el.dataset.id);
      if (from === -1 || to === -1) return;
      state.myHandOrder.splice(from, 1);
      state.myHandOrder.splice(to, 0, dragCardId);
      if (state.gameState) renderMe(state.gameState);
    });
  });
}

function fullCardHTML(card) {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  return `<div class="meld-card ${red} ${wild}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}
