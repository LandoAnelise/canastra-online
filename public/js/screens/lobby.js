import socket from '../socket.js';
import { state } from '../state.js';
import { showToast, showScreen } from '../utils.js';

// Tab switching
document.querySelectorAll('.lobby-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.lobby-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.remove('hidden');
    if (tab.dataset.tab === 'browse') loadPublicRooms();
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
  if (!name) { showToast('Digite seu nome!', 'error'); return; }
  state.myName = name;
  socket.emit('createRoom', { playerName: name, isPublic: state.selectedRoomType === 'public' }, (res) => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    state.myRoomId = res.roomId;
    state.mySeatIndex = res.seatIndex;
    document.getElementById('waiting-room-code').textContent = res.roomId;
    history.replaceState(null, '', `?sala=${res.roomId}`);
    showScreen('screen-waiting');
  });
});

// Random room code generator (for join-by-code tab)
document.getElementById('btn-random-room').addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('input-room').value = code;
});

// Join by code
export function joinRoomByCode(code) {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Digite seu nome!', 'error'); return; }
  if (!code) { showToast('Digite o código da sala!', 'error'); return; }
  state.myName = name;
  state.myRoomId = code;
  socket.emit('joinRoom', { roomId: code, playerName: name }, (res) => {
    if (!res.ok) { showToast(res.msg, 'error'); return; }
    state.mySeatIndex = res.seatIndex;
    document.getElementById('waiting-room-code').textContent = code;
    history.replaceState(null, '', `?sala=${code}`);
    if (res.reconnected) {
      showToast('✅ Reconectado com sucesso!', 'success', 3000);
    } else {
      showScreen('screen-waiting');
    }
  });
}

document.getElementById('btn-join').addEventListener('click', () => {
  joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
});
document.getElementById('input-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const activeTab = document.querySelector('.lobby-tab.active')?.dataset.tab;
    if (activeTab === 'join') joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
    else if (activeTab === 'create') document.getElementById('btn-create').click();
  }
});
document.getElementById('input-room').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoomByCode(document.getElementById('input-room').value.trim().toUpperCase());
});

// Auto-join from URL param — switch to join tab and pre-fill
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('sala')) {
  const code = urlParams.get('sala').toUpperCase();
  document.getElementById('input-room').value = code;
  // Switch to join tab
  document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lobby-panel').forEach(p => p.classList.add('hidden'));
  document.querySelector('[data-tab="join"]').classList.add('active');
  document.getElementById('panel-join').classList.remove('hidden');
}

// Public rooms
function loadPublicRooms() {
  const list = document.getElementById('public-rooms-list');
  list.innerHTML = '<div class="rooms-loading">Carregando…</div>';
  socket.emit('getPublicRooms', {}, (res) => {
    if (!res.ok) { list.innerHTML = '<div class="rooms-empty">Erro ao carregar.</div>'; return; }
    renderPublicRooms(res.rooms);
  });
}

export function renderPublicRooms(rooms) {
  const list = document.getElementById('public-rooms-list');
  if (!rooms || rooms.length === 0) {
    list.innerHTML = '<div class="rooms-empty">Nenhuma sala pública disponível no momento.</div>';
    return;
  }
  list.innerHTML = '';
  rooms.forEach(r => {
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
}

document.getElementById('btn-refresh-rooms').addEventListener('click', loadPublicRooms);
