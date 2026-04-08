// ── Sound engine — arquivos MP3 ───────────────────────────────────────────────
let _muted = localStorage.getItem('canastra_muted') === '1';
let _audioUnlocked = false;
let _unlockAudioEl = null;

const SOUND_URLS = {
  shine: '/sounds/shine.mp3',
  'canastra-suja': '/sounds/canastra_suja.mp3',
  campainha: '/sounds/campainha.mp3',
  chime: '/sounds/chime.mp3',
  thud: '/sounds/thud.mp3',
  whoosh: '/sounds/whoosh.mp3',
  pagina: '/sounds/pagina.mp3',
  knock: '/sounds/knock.mp3',
  bzz: '/sounds/bzz.mp3',
  win: '/sounds/win.mp3',
  lose: '/sounds/lose.mp3',
};

export function isMuted() {
  return _muted;
}

export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem('canastra_muted', _muted ? '1' : '0');
  return _muted;
}

// ── Pre-load de arquivos MP3 ──────────────────────────────────────────────────
const _cache = {};
function createAudio(url) {
  const a = new Audio(url);
  a.preload = 'auto';
  a.setAttribute('playsinline', '');
  a.setAttribute('webkit-playsinline', '');
  a.load();
  return a;
}

function load(name, url) {
  if (!_cache[name]) {
    _cache[name] = {
      url,
      audio: createAudio(url),
    };
  }
  return _cache[name];
}

async function unlockAudio() {
  if (_audioUnlocked) return;

  // Preload real assets, but do not play them during unlock.
  Object.entries(SOUND_URLS).forEach(([name, url]) => load(name, url));

  // iOS Safari may require one user-gesture play() call; use a silent clip so
  // no game sound leaks when the page is opened.
  if (!_unlockAudioEl) {
    _unlockAudioEl = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    _unlockAudioEl.preload = 'auto';
    _unlockAudioEl.setAttribute('playsinline', '');
    _unlockAudioEl.setAttribute('webkit-playsinline', '');
  }

  try {
    _unlockAudioEl.currentTime = 0;
    await _unlockAudioEl.play();
    _unlockAudioEl.pause();
    _unlockAudioEl.currentTime = 0;
  } catch (e) {}

  _audioUnlocked = true;
  document.removeEventListener('touchstart', onFirstUserGesture, true);
  document.removeEventListener('mousedown', onFirstUserGesture, true);
  document.removeEventListener('keydown', onFirstUserGesture, true);
}

function onFirstUserGesture() {
  unlockAudio().catch(() => {});
}

document.addEventListener('touchstart', onFirstUserGesture, true);
document.addEventListener('mousedown', onFirstUserGesture, true);
document.addEventListener('keydown', onFirstUserGesture, true);

function clearTrimHandler(audio) {
  if (audio._trimHandler) {
    audio.removeEventListener('timeupdate', audio._trimHandler);
    audio._trimHandler = null;
  }
}

function playFile(name, url, { volume = 1, maxDuration = null } = {}) {
  if (_muted) return;
  const entry = load(name, url);
  const a = entry.audio;
  clearTrimHandler(a);
  a.pause();
  a.volume = volume;
  try {
    a.currentTime = 0;
  } catch (e) {}
  if (maxDuration) {
    const trim = () => {
      if (a.currentTime >= maxDuration) {
        a.pause();
        a.removeEventListener('timeupdate', trim);
        a._trimHandler = null;
      }
    };
    a._trimHandler = trim;
    a.addEventListener('timeupdate', trim);
  }
  a.play().catch(() => {});
}

// ── Canastra Limpa — brilho agudo (arquivo real) ──────────────────────────────
export function playCanastraLimpa() {
  playFile('shine', '/sounds/shine.mp3', { volume: 0.9 });
}

// ── Canastra Suja — arpejo mais grave (arquivo real) ──────────────────────────
export function playCanastraSuja() {
  playFile('canastra-suja', '/sounds/canastra_suja.mp3', { volume: 0.9 });
}

// ── Campainha — sua vez de jogar (arquivo real) ───────────────────────────────
export function playCampainha() {
  playFile('campainha', '/sounds/campainha.mp3', { volume: 0.9 });
}

// ── Chime — fim de rodada (arquivo real) ──────────────────────────────────────
export function playChime() {
  playFile('chime', '/sounds/chime.mp3', { volume: 0.9 });
}

// ── Thud — tentativa inválida de pescar (arquivo real) ────────────────────────
export function playThud() {
  playFile('thud', '/sounds/thud.mp3', { volume: 0.9 });
}

// ── Deal — baixar cartas na mesa (desativado; trocar arquivo e descomentar quando encontrar som) ──
export function playDeal() {
  // playFile('deal', '/sounds/deal_preview.mp3', { volume: 0.85, maxDuration: 1.0 });
}

// ── Whoosh — pega o lixo (arquivo real) ──────────────────────────────────────
export function playWhoosh() {
  playFile('whoosh', '/sounds/whoosh.mp3', { volume: 0.8 });
}

// ── Página Virando — pesca uma carta (arquivo real) ───────────────────────────
export function playFolhaVirando() {
  playFile('pagina', '/sounds/pagina.mp3', { volume: 0.8 });
}

// ── Três batidinhas na madeira — pica (arquivo real) ─────────────────────────
export function playPica() {
  playFile('knock', '/sounds/knock.mp3', { volume: 0.9 });
}

// ── Bzz — ação proibida (arquivo real) ────────────────────────────────────────
export function playBzz() {
  playFile('bzz', '/sounds/bzz.mp3', { volume: 0.75, maxDuration: 0.4 });
}

// ── Vitória — time ganhador da rodada / jogo (arquivo real) ───────────────────
export function playWin() {
  playFile('win', '/sounds/win.mp3', { volume: 0.9, maxDuration: 4 });
}

// ── Derrota — time perdedor da rodada / jogo (arquivo real) ──────────────────
export function playLose() {
  playFile('lose', '/sounds/lose.mp3', { volume: 0.85, maxDuration: 5 });
}
