// Crash It — static file server + WebSocket lobby relay
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// code -> { host: ws, guest: ws|null }
const lobbies = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  } while (lobbies.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function peerOf(ws) {
  const lobby = lobbies.get(ws.lobbyCode);
  if (!lobby) return null;
  return ws === lobby.host ? lobby.guest : lobby.host;
}

function leaveLobby(ws, notifyPeer) {
  const code = ws.lobbyCode;
  if (!code) return;
  const lobby = lobbies.get(code);
  ws.lobbyCode = null;
  if (!lobby) return;
  const peer = ws === lobby.host ? lobby.guest : lobby.host;
  lobbies.delete(code);
  if (peer) {
    peer.lobbyCode = null;
    if (notifyPeer) send(peer, { t: 'peer_left' });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (typeof msg !== 'object' || !msg) return;

    switch (msg.t) {
      case 'create': {
        leaveLobby(ws, true);
        const code = makeCode();
        lobbies.set(code, { host: ws, guest: null });
        ws.lobbyCode = code;
        send(ws, { t: 'created', code });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const lobby = lobbies.get(code);
        if (!lobby) { send(ws, { t: 'err', msg: 'Lobby not found. Check the code.' }); return; }
        if (lobby.guest) { send(ws, { t: 'err', msg: 'That lobby is already full.' }); return; }
        leaveLobby(ws, true);
        lobby.guest = ws;
        ws.lobbyCode = code;
        send(lobby.host, { t: 'start', role: 'host', code });
        send(lobby.guest, { t: 'start', role: 'guest', code });
        break;
      }
      case 'leave': {
        leaveLobby(ws, true);
        break;
      }
      default: {
        // relay everything else to the lobby peer (inputs, snapshots, rematch...)
        const peer = peerOf(ws);
        if (peer) send(peer, msg);
      }
    }
  });

  ws.on('close', () => leaveLobby(ws, true));
});

// drop dead connections
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { leaveLobby(ws, true); return ws.terminate(); }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);
wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crash It running at http://localhost:${PORT}`);
});
