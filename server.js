'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createRoomManager } = require('./src/roomManager');
const { registerLobbyHandlers } = require('./src/handlers/lobby');
const { registerTeamHandlers } = require('./src/handlers/teams');
const { registerGameHandlers } = require('./src/handlers/game');
const { registerDisconnectHandler } = require('./src/handlers/disconnect');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

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
