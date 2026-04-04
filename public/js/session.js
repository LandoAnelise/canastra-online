// Persistência de sessão em localStorage para auto-reconexão
const KEY = 'canastra_session';

export function saveSession(roomId, playerName) {
  localStorage.setItem(KEY, JSON.stringify({ roomId, playerName, savedAt: Date.now() }));
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s?.roomId || !s?.playerName) return null;
    return s;
  } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
