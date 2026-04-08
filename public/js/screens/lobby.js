import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, showScreen } from '../utils.js';
import { saveSession } from '../session.js';

let _publicRoomsBootstrapped = false;

// Auto-refresh interval for the browse tab
let _browseInterval = null;
function startBrowseRefresh() {
  loadPublicRooms();
  clearInterval(_browseInterval);
  _browseInterval = setInterval(loadPublicRooms, 5000);
}
function stopBrowseRefresh() {
  clearInterval(_browseInterval);
  _browseInterval = null;
}

// Tab switching
document.querySelectorAll('.lobby-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lobby-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.lobby-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.remove('hidden');
    if (tab.dataset.tab === 'browse') startBrowseRefresh();
    else stopBrowseRefresh();
  });
});

// Room type selection
document.getElementById('type-private').addEventListener('click', () => {
  document.getElementById('type-private').classList.add('active');
  document.getElementById('type-public').classList.remove('active');
  state.selectedRoomType = 'private';
});
document.getElementById('type-public').addEventListener('click', () => {
  document.getElementById('type-public').classList.add('active');
  document.getElementById('type-private').classList.remove('active');
  state.selectedRoomType = 'public';
});

// Create Room
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) {
    showToast('Digite seu nome!', 'error');
    return;
  }
  state.myName = name;
  socket.emit('createRoom', { playerName: name, isPublic: state.selectedRoomType === 'public' }, (res) => {
    if (!res.ok) {
      showToast(res.msg, 'error');
      return;
    }
    state.myRoomId = res.roomId;
    state.mySeatIndex = res.seatIndex;
    saveSession(res.roomId, name);
    document.getElementById('waiting-room-code').textContent = res.roomId;
    history.replaceState(null, '', `?sala=${res.roomId}`);
    stopBrowseRefresh();
    showScreen('screen-waiting');
  });
});

// Test Room toggle (elemento ausente quando DEV_MODE=false)
document.getElementById('btn-toggle-test-room')?.addEventListener('click', () => {
  document.getElementById('test-room-panel').classList.toggle('hidden');
});

// Create Test Room
document.getElementById('btn-create-test')?.addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) {
    showToast('Digite seu nome!', 'error');
    return;
  }
  const s0 = parseInt(document.getElementById('test-score-0').value) || 0;
  const s1 = parseInt(document.getElementById('test-score-1').value) || 0;
  const botDifficulty = document.getElementById('test-bot-difficulty').value || 'medium';
  state.myName = name;
  socket.emit('createRoom', { playerName: name, testMode: true, testScores: [s0, s1], botDifficulty }, (res) => {
    if (!res.ok) {
      showToast(res.msg, 'error');
      return;
    }
    state.myRoomId = res.roomId;
    state.mySeatIndex = res.seatIndex;
    saveSession(res.roomId, name);
    history.replaceState(null, '', `?sala=${res.roomId}`);
    stopBrowseRefresh();
    showScreen('screen-game');
  });
});

// Join by code
export function joinRoomByCode(code) {
  const name = document.getElementById('input-name').value.trim();
  if (!name) {
    showToast('Digite seu nome!', 'error');
    return;
  }
  if (!code) {
    showToast('Digite o código da sala!', 'error');
    return;
  }
  state.myName = name;
  state.myRoomId = code;
  socket.emit('joinRoom', { roomId: code, playerName: name }, (res) => {
    if (!res.ok) {
      showToast(res.msg, 'error');
      return;
    }
    state.mySeatIndex = res.seatIndex;
    saveSession(code, name);
    document.getElementById('waiting-room-code').textContent = code;
    history.replaceState(null, '', `?sala=${code}`);
    stopBrowseRefresh();
    if (res.reconnected) {
      showToast('✅ Reconectado com sucesso!', 'success', 1000);
    } else {
      showScreen('screen-waiting');
    }
  });
}

document.getElementById('btn-join').addEventListener('click', () => {
  joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
});
document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activeTab = document.querySelector('.lobby-tab.active')?.dataset.tab;
    if (activeTab === 'join') joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
    else if (activeTab === 'create') document.getElementById('btn-create').click();
  }
});
document.getElementById('input-room').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
});

// Pré-preenche o nome salvo na sessão anterior
const _savedSession = (() => {
  try {
    return JSON.parse(localStorage.getItem('canastra_session'));
  } catch {
    return null;
  }
})();
if (_savedSession?.playerName) {
  const ni = document.getElementById('input-name');
  if (ni && !ni.value) ni.value = _savedSession.playerName;
}

// Auto-join from URL param — switch to join tab and pre-fill
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('sala')) {
  const code = urlParams.get('sala').toUpperCase();
  document.getElementById('input-room').value = code;
  // Switch to join tab
  document.querySelectorAll('.lobby-tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.lobby-panel').forEach((p) => p.classList.add('hidden'));
  document.querySelector('[data-tab="join"]').classList.add('active');
  document.getElementById('panel-join').classList.remove('hidden');
}

// Public rooms
export function loadPublicRooms() {
  const list = document.getElementById('public-rooms-list');
  list.innerHTML = '<div class="rooms-loading">Carregando…</div>';
  socket.emit('getPublicRooms', {}, (res) => {
    if (!res.ok) {
      list.innerHTML = '<div class="rooms-empty">Erro ao carregar.</div>';
      return;
    }
    renderPublicRooms(res.rooms);
  });
}

export function renderPublicRooms(rooms) {
  const list = document.getElementById('public-rooms-list');
  if (!rooms || rooms.length === 0) {
    list.innerHTML = '<div class="rooms-empty">Nenhuma sala pública disponível no momento.</div>';
    requestAnimationFrame(_syncScrollbar);
    return;
  }
  list.innerHTML = '';
  rooms.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'public-room-item';
    item.innerHTML = `
      <div>
        <div class="pri-code">${r.roomId}</div>
        <div class="pri-players">${r.players.join(', ')} · ${r.playerCount}/4</div>
      </div>
      <button class="pri-join-btn">Entrar →</button>`;
    item.querySelector('.pri-join-btn').addEventListener('click', () => {
      joinRoomByCode(r.roomId);
    });
    list.appendChild(item);
  });
  requestAnimationFrame(_syncScrollbar);
}

document.getElementById('btn-refresh-rooms').addEventListener('click', loadPublicRooms);

// ── Custom scrollbar (cross-browser) ─────────────────────────────────────────
const _roomsList = document.getElementById('public-rooms-list');
const _scrollArea = _roomsList?.closest('.public-rooms-scroll-area');
const _scrollTrack = _scrollArea?.querySelector('.rooms-scrollbar-track');
const _scrollThumb = _scrollArea?.querySelector('.rooms-scrollbar-thumb');

function _syncScrollbar() {
  if (!_roomsList || !_scrollThumb || !_scrollArea || !_scrollTrack) return;
  const { scrollTop, scrollHeight, clientHeight } = _roomsList;
  const isScrollable = scrollHeight > clientHeight + 1;
  _scrollArea.classList.toggle('is-scrollable', isScrollable);
  if (!isScrollable) return;
  const trackHeight = _scrollTrack.clientHeight;
  const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
  const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * (trackHeight - thumbHeight);
  _scrollThumb.style.height = thumbHeight + 'px';
  _scrollThumb.style.top = thumbTop + 'px';
}

let _dragStartY = 0;
let _dragStartScrollTop = 0;
let _isDragging = false;

function _onThumbPointerDown(e) {
  _isDragging = true;
  _dragStartY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
  _dragStartScrollTop = _roomsList.scrollTop;
  _scrollThumb.classList.add('dragging');
  e.preventDefault();
}

function _onPointerMove(e) {
  if (!_isDragging) return;
  const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
  const { scrollHeight, clientHeight } = _roomsList;
  const trackHeight = _scrollTrack.clientHeight;
  const thumbHeight = parseFloat(_scrollThumb.style.height) || 24;
  const ratio = (scrollHeight - clientHeight) / (trackHeight - thumbHeight);
  _roomsList.scrollTop = _dragStartScrollTop + (clientY - _dragStartY) * ratio;
}

function _onPointerUp() {
  if (!_isDragging) return;
  _isDragging = false;
  _scrollThumb?.classList.remove('dragging');
}

if (_scrollThumb) {
  _scrollThumb.addEventListener('mousedown', _onThumbPointerDown);
  _scrollThumb.addEventListener('touchstart', _onThumbPointerDown, { passive: false });
}
document.addEventListener('mousemove', _onPointerMove);
document.addEventListener('touchmove', _onPointerMove, { passive: true });
document.addEventListener('mouseup', _onPointerUp);
document.addEventListener('touchend', _onPointerUp);
_roomsList?.addEventListener('scroll', _syncScrollbar, { passive: true });

// Sempre busca a lista ao abrir/atualizar a página no lobby, mesmo fora da aba "browse".
loadPublicRooms();

// Re-sincroniza no primeiro connect após refresh/reabertura.
socket.on('connect', () => {
  if (_publicRoomsBootstrapped) return;
  _publicRoomsBootstrapped = true;
  loadPublicRooms();
});
