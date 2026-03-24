// ── Sound engine — arquivos reais + Web Audio API synthesis ───────────────────
let _ctx = null;
let _muted = localStorage.getItem('canastra_muted') === '1';

export function isMuted() { return _muted; }

export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem('canastra_muted', _muted ? '1' : '0');
  return _muted;
}

// ── Web Audio context (para sons sintéticos) ──────────────────────────────────
function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function safe(fn) {
  if (_muted) return;
  try { fn(ctx()); } catch (e) {}
}

function tone(c, freq, start, dur, vol = 0.25, type = 'sine') {
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.01);
}

// ── Pre-load de arquivos MP3 ──────────────────────────────────────────────────
const _cache = {};
function load(name, url) {
  if (!_cache[name]) {
    const a = new Audio(url);
    a.preload = 'auto';
    _cache[name] = a;
  }
  return _cache[name];
}

function playFile(name, url, { volume = 1, maxDuration = null } = {}) {
  if (_muted) return;
  load(name, url); // garante pré-carga
  const a = _cache[name].cloneNode();
  a.volume = volume;
  a.currentTime = 0;
  if (maxDuration) {
    const trim = () => { if (a.currentTime >= maxDuration) { a.pause(); a.removeEventListener('timeupdate', trim); } };
    a.addEventListener('timeupdate', trim);
  }
  a.play().catch(() => {});
}

// ── Canastra Limpa — brilho agudo (arquivo real) ──────────────────────────────
export function playCanastraLimpa() {
  playFile('shine', '/sounds/shine.mp3', { volume: 0.9 });
}

// ── Canastra Suja — arpejo mais grave (síntese) ───────────────────────────────
export function playCanastraSuja() {
  safe(c => {
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.09, 0.50, 0.22));
    tone(c, 1175, t + 0.38, 0.65, 0.15);
  });
}

// ── Campainha — sua vez de jogar (síntese) ────────────────────────────────────
export function playCampainha() {
  safe(c => {
    const t = c.currentTime;
    tone(c, 1174, t,        1.1, 0.28);
    tone(c, 1568, t,        0.5, 0.10);
    tone(c, 1174, t + 0.35, 0.9, 0.18);
    tone(c, 1568, t + 0.35, 0.4, 0.07);
  });
}

// ── Chime — fim de rodada (arquivo real) ──────────────────────────────────────
export function playChime() {
  playFile('chime', '/sounds/chime.mp3', { volume: 0.9 });
}

// ── Thud — tentativa inválida de pescar (arquivo real) ────────────────────────
export function playThud() {
  playFile('thud', '/sounds/thud.mp3', { volume: 0.9 });
}

// ── Deal — baixar cartas na mesa (arquivo real, primeiro segundo) ─────────────
export function playDeal() {
  playFile('deal', '/sounds/deal_preview.mp3', { volume: 0.85, maxDuration: 1.0 });
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
