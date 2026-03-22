'use strict';

// ─── SOCKET ───────────────────────────────────────────────────────────────────
const socket = io();

// ─── STATE ────────────────────────────────────────────────────────────────────
let myName = '';
let myRoomId = '';
let mySeatIndex = -1;
let gameState = null;
let selectedCards = [];
let myHandOrder = [];
let justDrawnCardId = null;
let readyPlayers = new Set();
let iAmReady = false;

// Suit interleaved by color: ♠(black) ♦(red) ♣(black) ♥(red)
const SUIT_ORDER = { '♠': 0, '♦': 1, '♣': 2, '♥': 3 };
const RANK_ORDER_SORT = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function autoSortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER_SORT.indexOf(a.rank) - RANK_ORDER_SORT.indexOf(b.rank);
  });
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function isRed(suit) { return suit === '♥' || suit === '♦'; }
function isWild(card) { return card.rank === '2'; }

function cardHTML(card, extra = '') {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  return `<div class="my-card ${red} ${wild} ${extra}" data-id="${card.id}" draggable="true">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

function miniCardHTML(card) {
  const red = isRed(card.suit) ? 'red' : '';
  const wild = isWild(card) ? 'wild' : '';
  return `<div class="meld-mini-card ${red} ${wild}"><span>${card.rank}</span><span>${card.suit}</span></div>`;
}

function discardCardHTML(card) {
  if (!card) return '<div class="pile-card front" style="opacity:0.25"><span>vazio</span></div>';
  const red = isRed(card.suit) ? 'red' : '';
  return `<div class="pile-card front ${red}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

function isCanastra(meld) { return meld.cards.length >= 7; }
function isCanastraLimpa(meld) { return isCanastra(meld) && meld.cards.every(c => !isWild(c)); }
function isCanastraSuja(meld)  { return isCanastra(meld) && meld.cards.some(c => isWild(c)); }

function showToast(msg, type = '', duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = type;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.add('hidden'), duration);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── LOBBY ───────────────────────────────────────────────────────────────────
document.getElementById('btn-random-room').addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('input-room').value = code;
});

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
document.getElementById('input-room').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('sala')) document.getElementById('input-room').value = urlParams.get('sala').toUpperCase();

function joinRoom() {
  const name = document.getElementById('input-name').value.trim();
  const room = document.getElementById('input-room').value.trim().toUpperCase();
  if (!name) { showToast('Digite seu nome!', 'error'); return; }
  if (!room) { showToast('Digite o código da sala!', 'error'); return; }
  myName = name; myRoomId = room;
  socket.emit('joinRoom', { roomId: room, playerName: name }, (res) => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    mySeatIndex = res.seatIndex;
    document.getElementById('waiting-room-code').textContent = room;
    history.replaceState(null, '', `?sala=${room}`);
    if (res.reconnected) {
      showToast('✅ Reconectado com sucesso!', 'success', 3000);
      // gameState will arrive via 'gameResumed' → broadcastState
    } else {
      showScreen('screen-waiting');
    }
  });
}

// ─── SOCKET EVENTS ───────────────────────────────────────────────────────────
socket.on('playerJoined', ({ playerName, totalPlayers }) => {
  showToast(`${playerName} entrou na sala (${totalPlayers}/4)`);
});

socket.on('teamsAssigned', ({ players }) => {
  readyPlayers = new Set();
  iAmReady = false;
  document.getElementById('ready-room-code').textContent = myRoomId;
  showScreen('screen-ready');
  renderReadyScreen(players);
});

socket.on('readyUpdate', ({ readyPlayers: rp, totalPlayers }) => {
  readyPlayers = new Set(rp);
  if (gameState) renderReadyScreen(gameState.players);
  const hint = document.getElementById('ready-hint');
  if (hint) hint.textContent = `${rp.length} de ${totalPlayers} prontos…`;
});

socket.on('roundStarted', ({ round }) => {
  showToast(`🃏 Rodada ${round} começando!`, 'success');
  myHandOrder = [];
  closeModal('modal-round');
  clearSelection();
});

socket.on('playerDisconnected', ({ playerName, reconnectWindowMs }) => {
  if (!reconnectWindowMs) {
    // Pre-game disconnect — just notify
    showToast(`⚠️ ${playerName || 'Jogador'} desconectou`, 'error', 5000);
  }
  // If reconnectWindowMs is set, gamePaused event handles the UI
});

socket.on('roundEnded', (result) => { showRoundModal(result); });

socket.on('gameState', (state) => {
  gameState = state;

  if (state.status === 'waiting') {
    renderWaiting(state);
    if (state.players.length === 4 && state.players.some(p => p.teamIndex === -1)) {
      showScreen('screen-teams');
      renderTeamSelection(state);
    } else if (state.players.length < 4) {
      showScreen('screen-waiting');
    }
    // if on ready screen, keep it — readyUpdate handles the render
  } else {
    // hand order is managed inside renderGame
    renderGame(state);
    if (!document.getElementById('screen-game').classList.contains('active')) {
      showScreen('screen-game');
    }
  }
});

// ─── WAITING ─────────────────────────────────────────────────────────────────
function renderWaiting(state) {
  const seats = document.getElementById('waiting-seats');
  seats.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const div = document.createElement('div');
    div.className = `seat-item ${p ? '' : 'empty'}`;
    div.innerHTML = `<span class="seat-name">${p ? p.name : 'Aguardando...'}</span>`;
    seats.appendChild(div);
  }
}

// ─── READY SCREEN ────────────────────────────────────────────────────────────
function renderReadyScreen(players) {
  const list = document.getElementById('ready-players-list');
  if (!list || !players) return;
  list.innerHTML = '';
  players.forEach((p, i) => {
    const isReady = readyPlayers.has(i);
    const isMe = i === mySeatIndex;
    const row = document.createElement('div');
    row.className = `ready-player-row${isReady ? ' is-ready' : ''}`;
    row.innerHTML = `
      <span class="rp-name${isMe ? ' me' : ''}">${p.name}${isMe ? ' (você)' : ''}</span>
      <span class="rp-status">${isReady ? '✅ Pronto!' : 'Aguardando…'}</span>`;
    list.appendChild(row);
  });

  const btn = document.getElementById('btn-ready');
  if (iAmReady) {
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
  if (iAmReady) return;
  iAmReady = true;
  socket.emit('playerReady', {}, (res) => {
    if (!res.ok) { showToast(res.msg, 'error'); iAmReady = false; return; }
    readyPlayers.add(mySeatIndex);
    if (gameState) renderReadyScreen(gameState.players);
  });
});

// ─── TEAM SELECTION ──────────────────────────────────────────────────────────
let teamAssignments = {};
let dragSeat = null;
let teamsInitialized = false;

function renderTeamSelection(state) {
  if (teamsInitialized) { updateTeamChips(state); return; }
  teamsInitialized = true;
  teamAssignments = {};
  state.players.forEach((_, i) => { teamAssignments[i] = -1; });

  ['unassigned-slots', 'team0-slots', 'team1-slots'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragSeat === null) return;
      const targetTeam = id === 'team0-slots' ? 0 : id === 'team1-slots' ? 1 : -1;
      if (targetTeam !== -1) {
        const inTeam = Object.values(teamAssignments).filter(t => t === targetTeam).length;
        if (inTeam >= 2) { showToast('Cada dupla só pode ter 2 jogadores.', 'error'); return; }
      }
      teamAssignments[dragSeat] = targetTeam;
      updateTeamChips(state);
      updateConfirmBtn();
    });
  });

  updateTeamChips(state);
}

function updateTeamChips(state) {
  const slots = {
    '-1': document.getElementById('unassigned-slots'),
    '0':  document.getElementById('team0-slots'),
    '1':  document.getElementById('team1-slots'),
  };
  Object.values(slots).forEach(s => s.innerHTML = '');

  state.players.forEach((p, i) => {
    const team = String(teamAssignments[i] ?? -1);
    const isMe = i === mySeatIndex;
    const chip = document.createElement('div');
    chip.className = `player-chip${isMe ? ' me-chip' : ''}`;
    chip.draggable = true;
    chip.dataset.seat = i;
    chip.innerHTML = `<div class="chip-avatar">${p.name.slice(0,2).toUpperCase()}</div>
      <span>${p.name}${isMe ? ' (você)' : ''}</span>`;
    chip.addEventListener('dragstart', () => {
      dragSeat = i;
      setTimeout(() => chip.classList.add('dragging'), 0);
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      dragSeat = null;
    });
    slots[team].appendChild(chip);
  });
}

function updateConfirmBtn() {
  const counts = [0, 1].map(t => Object.values(teamAssignments).filter(v => v === t).length);
  const ready = counts[0] === 2 && counts[1] === 2;
  document.getElementById('btn-confirm-teams').disabled = !ready;
  document.getElementById('teams-hint').textContent = ready
    ? 'Pronto! Confirme para iniciar.'
    : `Dupla 1: ${counts[0]}/2  ·  Dupla 2: ${counts[1]}/2`;
}

document.getElementById('btn-confirm-teams').addEventListener('click', () => {
  const teams = Object.entries(teamAssignments).map(([seat, team]) => ({
    seatIndex: parseInt(seat), teamIndex: team,
  }));
  socket.emit('assignTeams', { teams }, (res) => {
    if (!res.ok) showToast(res.msg, 'error');
  });
});

// ─── GAME RENDER ──────────────────────────────────────────────────────────────
function renderGame(state) {
  if (!state) return;

  // Sync hand order — auto-sort when starting fresh, otherwise preserve custom order
  const handIds = state.myHand.map(c => c.id);
  if (myHandOrder.length === 0) {
    // New round or first load — apply auto-sort
    myHandOrder = autoSortHand(state.myHand).map(c => c.id);
  } else {
    // Keep custom order, append any new cards (drawn/taken) at end
    myHandOrder = myHandOrder.filter(id => handIds.includes(id));
    handIds.forEach(id => { if (!myHandOrder.includes(id)) myHandOrder.push(id); });
  }

  document.getElementById('val-score-0').textContent = state.scores[0];
  document.getElementById('val-score-1').textContent = state.scores[1];
  document.getElementById('game-status-label').textContent = `Rodada ${state.round}`;

  const seats = getRelativeSeats(state);
  renderOpponent('top',   seats.top,   state);
  renderOpponent('left',  seats.left,  state);
  renderOpponent('right', seats.right, state);
  renderMe(state);

  document.getElementById('deck-count').textContent = `${state.deckSize} cartas`;
  document.getElementById('discard-count').textContent = `${state.discardSize} no lixo`;
  document.getElementById('discard-pile').querySelector('.pile-card')?.remove();
  document.getElementById('discard-pile').querySelector('.pile-count')
    .insertAdjacentHTML('beforebegin', discardCardHTML(state.discardTop));

  renderMelds(state);

  const isMyTurn = state.currentPlayerIndex === mySeatIndex;
  const currentName = state.players[state.currentPlayerIndex]?.name || '?';
  const turnBanner = document.getElementById('turn-banner');
  turnBanner.textContent = isMyTurn ? '🎯 Sua vez!' : `Vez de ${currentName}`;
  turnBanner.classList.remove('hidden');

  document.querySelectorAll('.player-slot').forEach(s => s.classList.remove('active-turn'));
  const slot = getSlotForSeat(state.currentPlayerIndex, state);
  if (slot) document.getElementById(`player-${slot}`)?.classList.add('active-turn');

  updateButtons(state);
  if (state.status === 'finished') showGameOverModal(state);
}

function getRelativeSeats(state) {
  const me = mySeatIndex;
  return { right: (me+1)%4, top: (me+2)%4, left: (me+3)%4 };
}

function getSlotForSeat(idx, state) {
  const s = getRelativeSeats(state);
  if (idx === mySeatIndex) return 'bottom';
  if (idx === s.top)   return 'top';
  if (idx === s.left)  return 'left';
  if (idx === s.right) return 'right';
  return null;
}

function renderOpponent(pos, seatIdx, state) {
  const p = state.players[seatIdx];
  document.getElementById(`name-${pos}`).textContent = p?.name || '—';
  document.getElementById(`count-${pos}`).textContent = `${state.handSizes[seatIdx] || 0} cartas`;
  const fan = document.getElementById(`hand-${pos}`);
  if (fan) {
    fan.innerHTML = '';
    for (let i = 0; i < Math.min(state.handSizes[seatIdx]||0, 13); i++)
      fan.insertAdjacentHTML('beforeend', '<div class="back-card"></div>');
  }
}

function renderMe(state) {
  document.getElementById('name-me').textContent = state.players[mySeatIndex]?.name || 'Você';
  document.getElementById('count-me').textContent = `${state.myHand.length} cartas`;

  const hand = document.getElementById('my-hand');
  hand.innerHTML = '';
  // Detect newly drawn cards
  if (window._prevHandIds) {
    const newIds = state.myHand.map(c => c.id).filter(id => !window._prevHandIds.has(id));
    if (newIds.length > 0) {
      justDrawnCardId = newIds[0]; // highlight first new card
      window._prevHandIds = null;
      setTimeout(() => { justDrawnCardId = null; }, 2500);
    }
  }

  const ordered = myHandOrder.map(id => state.myHand.find(c => c.id === id)).filter(Boolean);
  ordered.forEach(card => {
    const sel = selectedCards.includes(card.id) ? 'selected' : '';
    const drawn = card.id === justDrawnCardId ? 'just-drawn' : '';
    hand.insertAdjacentHTML('beforeend', cardHTML(card, `${sel} ${drawn}`));
  });

  hand.querySelectorAll('.my-card').forEach(el => {
    el.addEventListener('click', () => onCardClick(el.dataset.id));
  });

  setupHandDragDrop(hand);
}

// ─── HAND REORDER DRAG-AND-DROP ───────────────────────────────────────────────
let dragCardId = null;

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
      const from = myHandOrder.indexOf(dragCardId);
      const to   = myHandOrder.indexOf(el.dataset.id);
      if (from === -1 || to === -1) return;
      myHandOrder.splice(from, 1);
      myHandOrder.splice(to, 0, dragCardId);
      if (gameState) renderMe(gameState);
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

function renderMelds(state) {
  const isMyTurn = state.currentPlayerIndex === mySeatIndex;
  const drawn    = state.drawnThisTurn;

  // Update team labels — highlight the player's own team
  for (let t = 0; t < 2; t++) {
    const label    = document.getElementById(`melds-label-${t}`);
    const youBadge = label?.querySelector('.melds-label-you');
    const group    = document.getElementById(`melds-team${t}`);
    if (t === state.myTeam) {
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

    if (state.melds[t].length === 0) {
      list.innerHTML = '<span class="melds-empty">Nenhum grupo ainda</span>';
      continue;
    }

    state.melds[t].forEach((meld, mi) => {
      const isLimpa = isCanastraLimpa(meld);
      const isSuja  = isCanastraSuja(meld);
      const cls = isLimpa ? 'canastra-limpa' : isSuja ? 'canastra-suja' : '';
      const badge = isLimpa ? '<span class="canastra-badge limpa">✦ Limpa</span>'
                  : isSuja  ? '<span class="canastra-badge suja">✦ Suja</span>' : '';
      const typeLabel = meld.type === 'sequence' ? 'Sequência' : 'Grupo';
      const canAdd = isMyTurn && drawn && t === state.myTeam;

      const el = document.createElement('div');
      el.className = `meld-group-full ${cls}`;
      el.innerHTML = `
        <div class="meld-header">
          <span class="meld-type-label">${typeLabel} ${meld.cards.length} cartas</span>
          ${badge}
          ${canAdd ? `<button class="btn-add-to-meld" data-team="${t}" data-index="${mi}">+ Adicionar</button>` : ''}
        </div>
        <div class="meld-cards-row">${meld.cards.map(fullCardHTML).join('')}</div>`;

      // Add button handler
      if (canAdd) {
        el.querySelector('.btn-add-to-meld').addEventListener('click', () => {
          if (selectedCards.length === 0) { showToast('Selecione cartas na mão primeiro.', 'error'); return; }
          const meldActions = [{ type: 'add', meldIndex: mi, cards: [...selectedCards] }];
          socket.emit('playMelds', { meldActions }, res => {
            if (!res.ok) { showToast(res.msg, 'error'); return; }
            showToast('Cartas adicionadas!', 'success');
            clearSelection();
          });
        });
      }

      list.appendChild(el);
    });
  }
}

function updateButtons(state) {
  const isMyTurn = state.currentPlayerIndex === mySeatIndex;
  const drawn = state.drawnThisTurn;
  const hasCanastra = state.melds[state.myTeam]?.some(m => m.cards.length >= 7);
  document.getElementById('btn-draw').disabled          = !isMyTurn || drawn;
  document.getElementById('btn-take-discard').disabled  = !isMyTurn || drawn || !state.discardTop;
  document.getElementById('btn-play-melds').disabled    = !isMyTurn || !drawn || selectedCards.length === 0;
  document.getElementById('btn-discard').disabled       = !isMyTurn || !drawn;
  document.getElementById('btn-bater').disabled         = !isMyTurn || !drawn || !hasCanastra;
}

// ─── CARD CLICK ──────────────────────────────────────────────────────────────
function onCardClick(cardId) {
  if (!gameState || gameState.currentPlayerIndex !== mySeatIndex || !gameState.drawnThisTurn) {
    showToast('Não é sua vez ou você ainda não comprou.', 'error'); return;
  }
  selectedCards = selectedCards.includes(cardId)
    ? selectedCards.filter(id => id !== cardId)
    : [...selectedCards, cardId];

  renderMe(gameState);
  updateButtons(gameState);
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────
document.getElementById('btn-draw').addEventListener('click', () => {
  const prevIds = new Set(gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => {
    if (!res.ok) showToast(res.msg, 'error');
    // justDrawnCardId will be set in next gameState update via prevIds comparison
    window._prevHandIds = prevIds;
  });
});

document.getElementById('btn-take-discard').addEventListener('click', () => {
  window._prevHandIds = new Set(gameState?.myHand?.map(c => c.id) || []);
  socket.emit('takeDiscard', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

document.getElementById('btn-play-melds').addEventListener('click', () => {
  if (selectedCards.length < 3) { showToast('Selecione pelo menos 3 cartas.', 'error'); return; }
  socket.emit('playMelds', { meldActions: [{ type: 'new', cards: [...selectedCards] }] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    showToast('Grupo baixado!', 'success'); clearSelection();
  });
});

document.getElementById('btn-discard').addEventListener('click', () => {
  if (selectedCards.length !== 1) { showToast('Selecione exatamente 1 carta para descartar.', 'error'); return; }
  socket.emit('discard', { cardId: selectedCards[0] }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    clearSelection();
  });
});

document.getElementById('btn-bater').addEventListener('click', () => {
  const discardCardId = selectedCards.length === 1 ? selectedCards[0] : null;
  socket.emit('bater', { discardCardId }, res => {
    if (!res?.ok) { showToast(res?.msg || 'Erro ao bater.', 'error'); return; }
    clearSelection();
  });
});

document.getElementById('deck-pile').addEventListener('click', () => {
  if (!gameState || gameState.currentPlayerIndex !== mySeatIndex || gameState.drawnThisTurn) return;
  window._prevHandIds = new Set(gameState?.myHand?.map(c => c.id) || []);
  socket.emit('drawFromDeck', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

document.getElementById('discard-pile').addEventListener('click', (e) => {
  // Don't trigger take-discard if clicking the expand button
  if (e.target.id === 'btn-expand-discard') return;
  if (!gameState || gameState.currentPlayerIndex !== mySeatIndex || gameState.drawnThisTurn) return;
  if (!gameState.discardTop) { showToast('O lixo está vazio.', 'error'); return; }
  window._prevHandIds = new Set(gameState?.myHand?.map(c => c.id) || []);
  socket.emit('takeDiscard', {}, res => { if (!res.ok) showToast(res.msg, 'error'); });
});

function clearSelection() {
  selectedCards = [];
  if (gameState) renderMe(gameState);
  updateButtons(gameState);
}

// ─── INLINE DISCARD PILE EXPAND ──────────────────────────────────────────────
let discardExpanded = false;

document.getElementById('btn-expand-discard').addEventListener('click', (e) => {
  e.stopPropagation();
  discardExpanded = !discardExpanded;
  toggleDiscardExpand();
});

function toggleDiscardExpand() {
  const dropdown = document.getElementById('discard-dropdown');
  const btn = document.getElementById('btn-expand-discard');
  if (discardExpanded) {
    socket.emit('getDiscardPile', {}, (res) => {
      if (!res.ok) return;
      renderDiscardDropdown(res.cards);
      dropdown.classList.remove('hidden');
      btn.textContent = '▲';
    });
  } else {
    dropdown.classList.add('hidden');
    btn.textContent = '▼';
  }
}

function renderDiscardDropdown(cards) {
  const container = document.getElementById('discard-dropdown-cards');
  const countEl   = document.getElementById('discard-dropdown-count');
  countEl.textContent = `Pilha de descarte (${cards.length} cartas)`;
  container.innerHTML = '';
  cards.forEach(card => {
    const red = isRed(card.suit) ? 'red' : '';
    container.insertAdjacentHTML('beforeend',
      `<div class="discard-view-card ${red}">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit">${card.suit}</span>
      </div>`
    );
  });
}

document.getElementById('btn-close-discard-dropdown').addEventListener('click', () => {
  discardExpanded = false;
  document.getElementById('discard-dropdown').classList.add('hidden');
  document.getElementById('btn-expand-discard').textContent = '▼';
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const pile = document.getElementById('discard-pile');
  const dropdown = document.getElementById('discard-dropdown');
  if (discardExpanded && !pile.contains(e.target) && !dropdown.contains(e.target)) {
    discardExpanded = false;
    dropdown.classList.add('hidden');
    document.getElementById('btn-expand-discard').textContent = '▼';
  }
});

document.getElementById('btn-close-discard-modal')?.addEventListener('click', () => closeModal('modal-discard-pile'));

// ─── DRAG CARD TO DISCARD PILE ────────────────────────────────────────────────
const discardPileEl = document.getElementById('discard-pile');

discardPileEl.addEventListener('dragover', (e) => {
  if (!gameState || gameState.currentPlayerIndex !== mySeatIndex || !gameState.drawnThisTurn) return;
  if (!dragCardId) return;
  e.preventDefault();
  discardPileEl.classList.add('drop-target');
});

discardPileEl.addEventListener('dragleave', () => {
  discardPileEl.classList.remove('drop-target');
});

discardPileEl.addEventListener('drop', (e) => {
  e.preventDefault();
  discardPileEl.classList.remove('drop-target');
  if (!dragCardId) return;
  if (!gameState || gameState.currentPlayerIndex !== mySeatIndex || !gameState.drawnThisTurn) return;
  socket.emit('discard', { cardId: dragCardId }, res => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    clearSelection();
  });
});

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showRoundModal(result) {
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

function showGameOverModal(state) {
  const winner = state.scores[0] >= 2000 ? 0 : 1;
  document.getElementById('modal-go-title').textContent = `Dupla ${winner + 1} venceu! 🎉`;
  document.getElementById('modal-go-body').innerHTML = `
    <div class="score-row winner"><span class="label">Dupla 1</span><span class="value">${state.scores[0]} pts</span></div>
    <div class="score-row winner"><span class="label">Dupla 2</span><span class="value">${state.scores[1]} pts</span></div>`;
  document.getElementById('modal-gameover').classList.remove('hidden');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('newGame', {}, res => {
    if (!res.ok) showToast(res.msg, 'error');
    else { closeModal('modal-gameover'); teamsInitialized = false; }
  });
});

function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

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

// ─── CONNECTION ───────────────────────────────────────────────────────────────
socket.on('connect', () => console.log('Conectado'));
socket.on('disconnect', () => showToast('⚠️ Conexão perdida. Reconectando...', 'error', 8000));
socket.on('connect_error', () => showToast('Erro de conexão.', 'error', 5000));
