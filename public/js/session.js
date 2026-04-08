// Persistência de sessão em localStorage para auto-reconexão
const KEY = 'canastra_session';
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const NAME_RE = /^[^\x00-\x1F<>&]{1,10}$/;
const ROOM_RE = /^[A-Z2-9]{6}$/;

export function saveSession(roomId, playerName) {
  localStorage.setItem(KEY, JSON.stringify({ roomId, playerName, savedAt: Date.now() }));
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s || typeof s !== 'object') return null;
    if (typeof s.playerName !== 'string' || !NAME_RE.test(s.playerName)) return null;
    // Reject stale sessions
    if (s.savedAt && Date.now() - s.savedAt > MAX_SESSION_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    // Validate roomId if present
    if (s.roomId && (typeof s.roomId !== 'string' || !ROOM_RE.test(s.roomId))) {
      s.roomId = undefined;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

// Remove apenas o código da sala, mantendo o nome do jogador
export function clearRoomFromSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.playerName) {
      localStorage.setItem(KEY, JSON.stringify({ playerName: s.playerName }));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    localStorage.removeItem(KEY);
  }
}
