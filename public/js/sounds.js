// ── Sound engine — arquivos MP3 ───────────────────────────────────────────────
let _muted = localStorage.getItem('canastra_muted') === '1';
let _audioUnlocked = false;

const SOUND_POOL_SIZE = 3;
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
      players: Array.from({ length: SOUND_POOL_SIZE }, () => createAudio(url)),
      nextIndex: 0,
    };
  }
  return _cache[name];
}

async function unlockAudio() {
  if (_audioUnlocked) return;

  const entries = Object.entries(SOUND_URLS).map(([name, url]) => load(name, url));
  await Promise.all(
    entries.flatMap((entry) =>
      entry.players.map(async (audio) => {
        try {
          audio.muted = true;
          audio.currentTime = 0;
          await audio.play();
          audio.pause();
          audio.currentTime = 0;
        } catch (e) {
        } finally {
          audio.muted = false;
        }
      }),
    ),
  );

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

function pickPlayer(entry) {
  const idle = entry.players.find((audio) => audio.paused || audio.ended);
  if (idle) return idle;
  const audio = entry.players[entry.nextIndex % entry.players.length];
  entry.nextIndex = (entry.nextIndex + 1) % entry.players.length;
  return audio;
}

function playFile(name, url, { volume = 1, maxDuration = null } = {}) {
  if (_muted) return;
  const entry = load(name, url);
  const a = pickPlayer(entry);
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
      }
    };
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
