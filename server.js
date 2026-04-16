'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { createRoomManager } = require('./src/roomManager');
const { createRedisPersistence } = require('./src/statePersistence');
const { runBotTurns } = require('./src/BotAI');
const { registerLobbyHandlers } = require('./src/handlers/lobby');
const { registerTeamHandlers } = require('./src/handlers/teams');
const { registerGameHandlers } = require('./src/handlers/game');
const { registerDisconnectHandler } = require('./src/handlers/disconnect');

const app = express();
const server = http.createServer(app);

// CORS: allow same-origin in production, configurable via env
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : undefined; // undefined = same-origin only in production
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS || (process.env.NODE_ENV === 'production' ? false : '*'),
  },
  // Limit payload size to prevent abuse
  maxHttpBufferSize: 1e6, // 1MB
});

// Hash de fallback — só é calculado quando não há build do Vite
let cachedBuildHash = null;
function getBuildHash() {
  if (cachedBuildHash) return cachedBuildHash;
  try {
    cachedBuildHash = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    cachedBuildHash = Date.now().toString(36);
  }
  return cachedBuildHash;
}

// Manifesto gerado pelo Vite — só é usado em produção
let buildManifest = null;
if (process.env.NODE_ENV === 'production') {
  const MANIFEST_PATH = path.join(__dirname, 'dist', '.vite', 'manifest.json');
  try {
    buildManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    // Sem build disponível — fallback para ?v=HASH
  }
}

// Features de desenvolvimento — ativadas via variável de ambiente DEV_MODE=true
const DEV_MODE = process.env.DEV_MODE === 'true';

// ── SECURITY HEADERS ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Só serve /assets se em produção e buildManifest existe
if (process.env.NODE_ENV === 'production' && buildManifest) {
  app.use(
    '/assets',
    express.static(path.join(__dirname, 'dist', 'assets'), {
      etag: true,
      lastModified: true,
      index: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
}

// Arquivos estáticos sem build (ícones, sons, sw.js) — sem cache
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    index: false, // impede express.static de servir index.html automaticamente
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }),
);

// Serve index.html com ?v=HASH injetado nos imports de CSS e JS
// e blocos de dev condicionalmente incluídos/removidos
const HTML_PATH = path.join(__dirname, 'public', 'index.html');
app.get('/', (req, res) => serveVersionedHtml(res));
app.get('/index.html', (req, res) => serveVersionedHtml(res));
function serveVersionedHtml(res) {
  let html = fs.readFileSync(HTML_PATH, 'utf8');

  // Blocos de dev: incluir ou remover conforme DEV_MODE
  if (DEV_MODE) {
    html = html.replace(/<!--DEV_BLOCK_START-->/g, '').replace(/<!--DEV_BLOCK_END-->/g, '');
    html = html.replace('<!--DEV_SCRIPT-->', '<script type="module" src="/js/game/dev.js"></script>');
  } else {
    html = html.replace(/<!--DEV_BLOCK_START-->[\s\S]*?<!--DEV_BLOCK_END-->/g, '');
    html = html.replace('<!--DEV_SCRIPT-->', '');
  }

  if (process.env.NODE_ENV === 'production' && buildManifest) {
    // Substituir caminhos de CSS e JS pelos equivalentes com hash do Vite
    html = html.replace(/(href|src)="(\/(?:css|js)[^"]+)"/g, (_, attr, url) => {
      const key = `public${url}`;
      const entry = buildManifest[key];
      if (entry) {
        return `${attr}="/${entry.file}"`;
      }
      return `${attr}="${url}"`;
    });
  } else {
    // Sempre usa ?v=HASH em dev
    const buildHash = getBuildHash();
    html = html.replace(/(href|src)="(\/(?:css|js)[^"]+)"/g, (_, attr, url) => {
      const sep = url.includes('?') ? '&' : '?';
      return `${attr}="${url}${sep}v=${buildHash}"`;
    });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

const rm = createRoomManager(io);
const persistence = createRedisPersistence(console);
let persistenceSaveRunning = false;

async function flushPersistentState(reason, { force = false } = {}) {
  if (!persistence.isEnabled()) return;
  if (persistenceSaveRunning) return;
  if (!force && !rm.isDirty()) return;

  persistenceSaveRunning = true;
  try {
    const snapshot = rm.exportState();
    const ok = await persistence.saveState(snapshot);
    if (ok) {
      rm.clearDirty();
      if (reason && reason !== 'interval') console.log(`[Redis] Snapshot saved (${reason}).`);
    }
  } finally {
    persistenceSaveRunning = false;
  }
}

async function initPersistence() {
  const connected = await persistence.init();
  if (!connected) return;

  const savedState = await persistence.loadState();
  if (savedState) {
    const restored = rm.importState(savedState);
    console.log(
      `[Redis] Restored ${restored.restoredRooms} room(s) and ${restored.restoredPublicRooms} public lobby/lobbies.`,
    );
    scheduleRestoredDisconnectTimers();
  } else {
    console.log('[Redis] No saved state found.');
  }

  const saveIntervalMs = persistence.getSaveIntervalMs();
  setInterval(() => {
    void flushPersistentState('interval');
  }, saveIntervalMs);
}

// After a server restart the reconnect slots rebuilt from Redis have no live timer.
// This restarts the 5-minute bot-replacement countdown for each of those slots.
function scheduleRestoredDisconnectTimers() {
  const {
    rooms,
    roomMeta,
    reconnectSlots,
    RECONNECT_TIMEOUT_MS,
    broadcastToRoom,
    broadcastState,
    countDisconnectedPlayers,
  } = rm;

  for (const [key, slot] of reconnectSlots) {
    if (slot.disconnectTimer !== null) continue;

    const [roomId] = key.split('|');
    const game = rooms.get(roomId);
    if (!game) {
      reconnectSlots.delete(key);
      continue;
    }

    const seatIndex = slot.seatIndex;
    const playerName = slot.playerName || key.split('|')[1];

    slot.disconnectTimer = setTimeout(() => {
      reconnectSlots.delete(key);
      if (!rooms.has(roomId)) return;

      game.botSeats = game.botSeats || new Set();
      const remainingHumans = game.players.filter((p, i) => i !== seatIndex && p?.id && !game.botSeats.has(i));

      if (remainingHumans.length === 0) {
        console.log(`[Room ${roomId}] Todos os jogadores saíram — encerrando sala`);
        broadcastToRoom(roomId, 'gameAbandoned', { playerName });
        rooms.delete(roomId);
        roomMeta.delete(roomId);
        return;
      }

      console.log(`[Room ${roomId}] 🤖 ${playerName} substituído por bot (após reinício)`);
      game.players[seatIndex].id = `bot_${seatIndex}_${Date.now()}`;
      game.botSeats.add(seatIndex);
      game.botDifficulty = game.botDifficulty || 'medium';

      if (game.leaderSeatIndex === seatIndex) {
        const nextHuman = game.players.findIndex((p, i) => i !== seatIndex && p?.id && !game.botSeats.has(i));
        if (nextHuman !== -1) game.leaderSeatIndex = nextHuman;
      }

      const stillDisconnected = countDisconnectedPlayers(roomId);
      if (stillDisconnected === 0) game.paused = false;

      broadcastToRoom(roomId, 'gameResumed', {
        playerName: `${playerName} (Bot)`,
        stillPaused: stillDisconnected > 0,
      });
      broadcastState(game);

      if (game.status === 'playing' && game.currentPlayerIndex === seatIndex) {
        runBotTurns(game, roomId, rm, game.botDifficulty);
      }

      if (game.status === 'roundOver' && game.leaderSeatIndex === seatIndex) {
        setTimeout(() => {
          if (game.status !== 'roundOver') return;
          game.startRound();
          broadcastToRoom(roomId, 'roundStarted', { round: game.round });
          broadcastState(game);
          runBotTurns(game, roomId, rm, game.botDifficulty);
        }, 3000);
      }
    }, RECONNECT_TIMEOUT_MS);
  }
}

// ── CONNECTION RATE LIMITING ──
const connectionAttempts = new Map(); // ip → { count, resetAt }
const CONN_RATE_LIMIT = 20; // max connections per window
const CONN_RATE_WINDOW = 60_000; // 1 minute window

io.use((socket, next) => {
  const ip = socket.handshake.address;
  const now = Date.now();
  let entry = connectionAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + CONN_RATE_WINDOW };
    connectionAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > CONN_RATE_LIMIT) {
    return next(new Error('Rate limit exceeded'));
  }
  next();
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of connectionAttempts) {
    if (now > entry.resetAt) connectionAttempts.delete(ip);
  }
}, 60_000);

io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);
  registerLobbyHandlers(socket, rm);
  registerTeamHandlers(socket, io, rm);
  registerGameHandlers(socket, io, rm);
  registerDisconnectHandler(socket, io, rm);
});

// ── STALE ROOM CLEANUP ──
// Every 10 minutes, remove rooms that have been empty or inactive for 30+ minutes
const STALE_ROOM_CHECK_INTERVAL = 10 * 60_000;
const STALE_ROOM_MAX_AGE = 30 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [roomId, game] of rm.rooms) {
    // Skip rooms with active human players
    const hasHumans = game.players.some(
      (p, i) => p?.id && !p.id.startsWith('bot') && !(game.botSeats && game.botSeats.has(i)),
    );
    if (hasHumans) {
      // Update last activity timestamp
      game._lastActivity = now;
      continue;
    }
    // Remove if no humans and stale
    const lastActivity = game._lastActivity || game._createdAt || 0;
    if (now - lastActivity > STALE_ROOM_MAX_AGE) {
      console.log(`[Cleanup] Removing stale room ${roomId}`);
      rm.rooms.delete(roomId);
      rm.roomMeta.delete(roomId);
    }
  }
}, STALE_ROOM_CHECK_INTERVAL);

const PORT = process.env.PORT || 3000;

async function start() {
  await initPersistence();

  server.listen(PORT, () => {
    console.log(`\n🃏 Canastra Online rodando em http://localhost:${PORT}\n`);
  });
}

async function shutdown(signal) {
  console.log(`[Server] Received ${signal}, flushing state...`);
  await flushPersistentState(signal, { force: true });
  await persistence.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void start();
