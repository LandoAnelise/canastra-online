// Persistência de sessão em localStorage para auto-reconexão
const KEY = 'canastra_session';

export function saveSession(roomId, playerName) {
  localStorage.setItem(KEY, JSON.stringify({ roomId, playerName, savedAt: Date.now() }));
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s?.playerName) return null;
    return s; // roomId pode ser undefined (sala inválida foi limpa)
  } catch { return null; }
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
  } catch { localStorage.removeItem(KEY); }
}
