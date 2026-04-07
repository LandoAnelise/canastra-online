'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { createRoomManager } = require('./src/roomManager');
const { registerLobbyHandlers } = require('./src/handlers/lobby');
const { registerTeamHandlers } = require('./src/handlers/teams');
const { registerGameHandlers } = require('./src/handlers/game');
const { registerDisconnectHandler } = require('./src/handlers/disconnect');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Hash do commit atual — muda a cada deploy, invalida cache do browser
const BUILD_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return Date.now().toString(36); }
})();

// Features de desenvolvimento — ativadas via variável de ambiente DEV_MODE=true
const DEV_MODE = process.env.DEV_MODE === 'true';

// CSS/JS: cache longo com versionamento por query string (?v=HASH)
// HTML: nunca cachear (sempre busca versão nova que referencia o hash correto)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

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

  // Injetar ?v=HASH em todos os imports de CSS e JS
  html = html.replace(/(href|src)="(\/(?:css|js)[^"]+)"/g, (_, attr, url) => {
    const sep = url.includes('?') ? '&' : '?';
    return `${attr}="${url}${sep}v=${BUILD_HASH}"`;
  });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

const rm = createRoomManager(io);

io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);
  registerLobbyHandlers(socket, rm);
  registerTeamHandlers(socket, io, rm);
  registerGameHandlers(socket, io, rm);
  registerDisconnectHandler(socket, io, rm);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Canastra Online rodando em http://localhost:${PORT}\n`);
});
