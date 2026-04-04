import socket from '../socket.js';
import { state } from '../state.js';
import { autoSortHand, isRed, isWild, cardHTML, isCanastra, isCanastraLimpa, isCanastraSuja, showToast } from '../utils.js';
import { playBzz, playCanastraLimpa, playCanastraSuja, playPica, playDeal } from '../sounds.js';

// Track canastra state per meld to detect new ones
const _canastraState = {};
// Track previous hand sizes to detect pica (1 card left)
const _prevHandSizes = {};
// Track meld card counts to detect new/grown melds for highlight
const _prevMeldCardCounts = {};

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

  // Detectar pica (qualquer jogador caiu para 1 carta)
  gs.handSizes.forEach((size, i) => {
    if (size === 1 && (_prevHandSizes[i] ?? 99) > 1) playPica();
    _prevHandSizes[i] = size;
  });

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
  document.getElementById('deck-pile').querySelector('.pile-card')?.classList.toggle('hidden', gs.deckSize === 0);
  document.getElementById('discard-count').textContent = `${gs.discardSize} no lixo`;
  const discardStack = document.getElementById('discard-stack');
  const btnExpand = document.getElementById('btn-expand-discard');
  discardStack.innerHTML = '';
  if (gs.discardPile && gs.discardPile.length > 0) {
    const COMPACT_MAX = 12;
    const OVERLAP_PX  = 34; // fixed overlap — always the same distance between cards
    const displayCards = gs.discardPile.slice(-COMPACT_MAX);
    displayCards.forEach((card, i) => {
      const ml = i === 0 ? '' : `style="margin-left:-${OVERLAP_PX}px"`;
      discardStack.insertAdjacentHTML('beforeend', fullCardHTML(card, '', ml));
    });
  }
  // Show/hide expand button
  if (gs.discardSize > 12) {
    btnExpand.classList.remove('hidden');
  } else {
    btnExpand.classList.add('hidden');
  }

  renderMelds(gs);

  const isMyTurn = gs.currentPlayerIndex === state.mySeatIndex;
  const currentName = gs.players[gs.currentPlayerIndex]?.name || '?';
  const turnBanner = document.getElementById('turn-banner');
  const isLastTurn = gs.deckEmpty && gs.deckEmptyLastDrawer === gs.currentPlayerIndex;
  if (isMyTurn) {
    turnBanner.textContent = isLastTurn ? '🎯 Sua vez! (última — monte acabou)' : '🎯 Sua vez!';
  } else {
    turnBanner.textContent = isLastTurn ? `Vez de ${currentName} (última — monte acabou)` : `Vez de ${currentName}`;
  }
  turnBanner.classList.remove('hidden');

  document.querySelectorAll('.player-slot').forEach(s => s.classList.remove('active-turn'));
  const slot = getSlotForSeat(gs.currentPlayerIndex, gs);
  if (slot) document.getElementById(`player-${slot}`)?.classList.add('active-turn');

  updateButtons(gs);
  if (gs.status === 'finished' && !window._roundEndedPending) {
    // Import lazily to avoid circular dependency (só ao reconectar — roundEnded cuida do caso normal)
    import('./modals.js').then(m => m.showGameOverModal(gs));
  }
}

function getRelativeSeats(gs) {
  const me = state.mySeatIndex;

  // Use playOrder to assign positions: right = next to play, left = previous, top = partner
  if (gs.playOrder && gs.playOrder.length === 4) {
    const pos = gs.playOrder.indexOf(me);
    const right = gs.playOrder[(pos + 1) % 4]; // próximo a jogar
    const top   = gs.playOrder[(pos + 2) % 4]; // parceiro
    const left  = gs.playOrder[(pos + 3) % 4]; // jogou antes
    return { top, right, left };
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

  // Staged cards are excluded by the server (not in myHand); just map the hand order
  const ordered = state.myHandOrder
    .map(id => gs.myHand.find(c => c.id === id))
    .filter(Boolean);

  const isMobile = window.innerWidth <= 600;
  const MOBILE_ROW_MAX = 9;
  const needsTwoRows = isMobile && ordered.length > MOBILE_ROW_MAX;

  // Sync two-row state on slot and table grid
  const slot = hand.closest('.player-slot');
  const tableArea = document.getElementById('table-area');
  if (needsTwoRows) {
    hand.setAttribute('data-rows', '2');
    slot?.classList.add('two-rows');
    tableArea?.classList.add('has-two-rows');
  } else {
    hand.setAttribute('data-rows', '1');
    slot?.classList.remove('two-rows');
    tableArea?.classList.remove('has-two-rows');
  }

  if (needsTwoRows) {
    const mid = Math.ceil(ordered.length / 2);
    [ordered.slice(0, mid), ordered.slice(mid)].forEach((rowCards, ri) => {
      const rowEl = document.createElement('div');
      rowEl.className = `hand-row hand-row-${ri + 1}`;
      rowCards.forEach(card => {
        const sel = state.selectedCards.includes(card.id) ? 'selected' : '';
        const drawn = card.id === state.justDrawnCardId ? 'just-drawn' : '';
        rowEl.insertAdjacentHTML('beforeend', cardHTML(card, `${sel} ${drawn}`));
      });
      hand.appendChild(rowEl);
    });
  } else {
    ordered.forEach(card => {
      const sel = state.selectedCards.includes(card.id) ? 'selected' : '';
      const drawn = card.id === state.justDrawnCardId ? 'just-drawn' : '';
      hand.insertAdjacentHTML('beforeend', cardHTML(card, `${sel} ${drawn}`));
    });
  }

  hand.querySelectorAll('.my-card').forEach(el => {
    el.addEventListener('click', () => onCardClick(el.dataset.id));
  });

  setupHandDragDrop(hand);
}

export function renderStagedMelds() {
  // No-op: staged melds are now rendered inside renderMelds() using server state (gs.stagedMelds)
}

export function renderMelds(gs) {
  // Detect newly formed canastras and suja→limpa transitions
  gs.melds.forEach((teamMelds, t) => {
    teamMelds.forEach((meld, mi) => {
      const key  = `${t}-${mi}`;
      const prev = _canastraState[key] || { isC: false, isL: false };
      const isC  = isCanastra(meld);
      const isL  = isCanastraLimpa(meld);
      if (isC && !prev.isC) {
        isL ? playCanastraLimpa() : playCanastraSuja();
      } else if (isC && isL && !prev.isL) {
        playCanastraLimpa(); // era suja, ficou limpa
      }
      _canastraState[key] = { isC, isL };
    });
  });

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
      if (group) group.style.order = '2';
    } else {
      group?.classList.remove('my-team');
      youBadge?.classList.add('hidden');
      if (group) group.style.order = '0';
    }
  }

  for (let t = 0; t < 2; t++) {
    const list = document.getElementById(`melds-list-${t}`);
    list.innerHTML = '';

    // Staged melds (em espera — not yet committed): visible to all players
    let hasStagedForTeam = false;
    if (gs.stagedMelds) {
      gs.players.forEach((p, seatIdx) => {
        if (p.teamIndex !== t) return;
        const playerStaged = gs.stagedMelds[seatIdx] || [];
        if (playerStaged.length === 0) return;

        hasStagedForTeam = true;

        const stagingLabel = seatIdx === gs.myIndex
          ? 'Em espera'
          : `Em espera — ${gs.players[seatIdx].name}`;

        const penalty = gs.firstMeldPenalty?.[t];
        const penaltyBadge = penalty
          ? '<span class="canastra-badge suja" title="Penalidade: precisam de 150 pts">⚠ 150 pts</span>'
          : '';

        playerStaged.forEach((meld, smi) => {
          const isMyStaged = seatIdx === gs.myIndex;
          const canAddToStaged = isMyStaged && isMyTurn && drawn;
          const el = document.createElement('div');
          el.className = 'meld-group-full staged-pending' + (canAddToStaged ? ' can-add' : '');
          el.innerHTML = `
            <div class="meld-header">
              <span class="meld-type-label staged-label-text">${stagingLabel}</span>
              ${penaltyBadge}
            </div>
            <div class="meld-cards-row">${meld.cards.map(c => fullCardHTML(c)).join('')}</div>`;

          if (canAddToStaged) {
            el.addEventListener('click', () => {
              if (state.selectedCards.length === 0) return;
              socket.emit('addToStagedMeld', { stagedMeldIdx: smi, cardIds: [...state.selectedCards] }, res => {
                if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
                clearSelection();
              });
            });
          }

          list.appendChild(el);
        });
      });
    }

    if (gs.melds[t].length === 0 && !hasStagedForTeam) {
      list.innerHTML = '<span class="melds-empty">Nenhum grupo ainda</span>';
      continue;
    }

    gs.melds[t].forEach((meld, mi) => {
      const isLimpa = isCanastraLimpa(meld);
      const isSuja  = isCanastraSuja(meld);
      const cls = isLimpa ? 'canastra-limpa' : isSuja ? 'canastra-suja' : '';
      const badge = isLimpa ? '<span class="canastra-badge limpa">✦ Limpa</span>'
                  : isSuja  ? '<span class="canastra-badge suja">✦ Suja</span>' : '';
      const typeLabel = meld.type === 'sequence' ? 'sq.' : 'gp.';
      const canAdd = isMyTurn && drawn && t === gs.myTeam;

      // Detect new or grown meld for highlight
      const meldKey = `${t}-${mi}`;
      const prevCount = _prevMeldCardCounts[meldKey] ?? -1;
      const shouldHighlight = meld.cards.length > prevCount;
      _prevMeldCardCounts[meldKey] = meld.cards.length;

      const isMobileView = window.matchMedia('(max-width: 600px)').matches;
      const shouldStack  = isMobileView && meld.cards.length > 4;

      // Um 2 é coringa ATUANDO se aparece ao lado de cartas não-coringa (independente do naipe)
      const isActingWild = (c) => {
        if (!isWild(c)) return false;
        return meld.cards.some(n => !isWild(n));
      };

      // Build card HTML — tag cards for CSS stacking
      const cardsHTML = meld.cards.map((card, ci, arr) => {
        let extra = '';
        if (shouldStack) {
          const prevActing  = ci >= 1 && isActingWild(arr[ci - 1]);
          const prev2Acting = ci >= 2 && isActingWild(arr[ci - 2]);
          // stack-after-visible (-26px) → mostra 18px da carta anterior
          const needsVisible = ci === 1 || prevActing || prev2Acting || isActingWild(card);
          if (ci === arr.length - 1) {
            extra = needsVisible ? 'stack-after-visible' : 'stack-last';
          } else if (ci > 0 && needsVisible) {
            extra = 'stack-after-visible';
          }
        }
        return fullCardHTML(card, extra);
      }).join('');

      const el = document.createElement('div');
      el.className = `meld-group-full ${cls}${shouldHighlight ? ' meld-new' : ''}${canAdd || shouldStack ? ' can-add' : ''}`;
      el.innerHTML = `
        <div class="meld-header">
          <span class="meld-type-label">${typeLabel} ${meld.cards.length} cartas</span>
          ${badge}
        </div>
        <div class="meld-cards-row${shouldStack ? ' stacked' : ''}">${cardsHTML}</div>`;

      // Unified click: expand stacked OR add selected cards
      el.addEventListener('click', () => {
        // Priority 1: add cards — always intercept if cards are selected
        if (state.selectedCards.length > 0) {
          const gs = state.gameState;
          const nowMyTurn = gs?.currentPlayerIndex === state.mySeatIndex;
          const nowDrawn  = gs?.drawnThisTurn;
          if (!nowMyTurn) { showToast('Aguarde seu turno para jogar.', 'error'); playBzz(); return; }
          if (!nowDrawn)  { showToast('Compre ou junte da mesa antes de jogar.', 'error'); playBzz(); return; }
          const meldActions = [{ type: 'add', meldIndex: mi, cards: [...state.selectedCards] }];
          socket.emit('playMelds', { meldActions }, res => {
            if (!res.ok) { showToast(res.msg, 'error'); playBzz(); return; }
            showToast('Cartas adicionadas!', 'success', 1000);
            playDeal(); clearSelection();
          });
          return;
        }
        // Priority 2: expand stacked meld
        if (shouldStack) {
          const row = el.querySelector('.meld-cards-row');
          if (row.classList.contains('expanded')) return;
          row.classList.add('expanded');
          el.classList.add('meld-stack-expanded');
          clearTimeout(el._expandTimer);
          el._expandTimer = setTimeout(() => {
            row.classList.remove('expanded');
            el.classList.remove('meld-stack-expanded');
          }, 1500);
          return;
        }
        // Priority 3: inform user to select cards
        if (canAdd) showToast('Selecione cartas na mão primeiro.', 'error');
      });

      // Drag-to-meld (desktop only, canAdd)
      if (canAdd) {
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
            showToast('Carta adicionada!', 'success', 1000);
            clearSelection();
          });
        });
      }

      list.appendChild(el);
    });
  }

  // Mobile: scroll new/updated meld into view
  if (window.matchMedia('(max-width: 600px)').matches) {
    requestAnimationFrame(() => {
      const newMeld = document.querySelector('.meld-group-full.meld-new');
      if (newMeld) newMeld.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

export function updateButtons(gs) {
  const isMyTurn = gs.currentPlayerIndex === state.mySeatIndex;
  const drawn = gs.drawnThisTurn;
  const hasCanastra = gs.melds[gs.myTeam]?.some(m => m.cards.length >= 7);
  const isStaging = (gs.stagedMelds?.[gs.myIndex]?.length ?? 0) > 0;
  const showBater = isMyTurn && drawn && hasCanastra && gs.myHand.length === 1;

  const btnPlayMelds = document.getElementById('btn-play-melds');
  const btnConfirm   = document.getElementById('btn-confirm-melds');
  const btnCancel    = document.getElementById('btn-cancel-melds');

  // During staging: "Baixar" stays active (add more melds), "Confirmar" appears, "Cancelar" hidden
  btnPlayMelds.disabled = !isMyTurn || !drawn || state.selectedCards.length < 3;
  btnConfirm.classList.toggle('hidden', !isStaging);
  btnConfirm.disabled = !isStaging;
  btnCancel.classList.add('hidden'); // cancel removed — staging is server-side and irreversible

  document.getElementById('btn-discard').disabled = !isMyTurn || !drawn || isStaging;
  document.getElementById('btn-bater').classList.toggle('hidden', !showBater);
  document.getElementById('btn-bater').disabled = !showBater;
}

export function onCardClick(cardId) {
  state.selectedCards = state.selectedCards.includes(cardId)
    ? state.selectedCards.filter(id => id !== cardId)
    : [...state.selectedCards, cardId];
  renderMe(state.gameState);
  updateButtons(state.gameState);
}

export function resetRoundState() {
  // Clear per-round tracking so new round melds get highlight treatment
  for (const k in _canastraState) delete _canastraState[k];
  for (const k in _prevMeldCardCounts) delete _prevMeldCardCounts[k];
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

const FACE_GLYPH = { 'K': '♚', 'Q': '♛', 'J': '♞' };

function fullCardHTML(card, extraClass = '', extraStyle = '') {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  const glyph = FACE_GLYPH[card.rank];
  const face = glyph
    ? `<span class="meld-face">${glyph}</span>`
    : `<span class="meld-face-suit">${card.suit}</span>`;
  return `<div class="meld-card ${red} ${wild} ${extraClass}" ${extraStyle}>
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
    ${face}
  </div>`;
}
