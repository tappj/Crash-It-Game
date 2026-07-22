// Crash It — static file server + WebSocket lobby relay
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    // Revalidate executable game files on each page load. The browser retains
    // its cached copy and receives a tiny 304 response when unchanged, while a
    // deployment cannot leave an old client speaking a new server protocol.
    if (/\.(?:html|css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  },
}));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 8 * 1024,
  // Browser-supported compression cuts the compact snapshot traffic further.
  // No context takeover prevents an idle connection from retaining a growing
  // compression dictionary in server memory.
  perMessageDeflate: {
    threshold: 64,
    concurrencyLimit: 4,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    zlibDeflateOptions: { level: 3 },
  },
});

// code -> { host: ws, guest: ws|null }
const lobbies = new Map();
const MAX_LOBBIES = 500;
const LOBBY_WAIT_MS = 15 * 60 * 1000;

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
        if (lobbies.size >= MAX_LOBBIES) {
          send(ws, { t: 'err', msg: 'The lobby server is busy. Please try again shortly.' });
          return;
        }
        const code = makeCode();
        lobbies.set(code, { host: ws, guest: null, createdAt: Date.now() });
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
  const now = Date.now();
  for (const [code, lobby] of lobbies) {
    // A waiting code has no game state and should not live forever if its
    // creator abandons a browser tab without disconnecting.
    if (!lobby.guest && now - lobby.createdAt >= LOBBY_WAIT_MS) {
      lobbies.delete(code);
      if (lobby.host) {
        lobby.host.lobbyCode = null;
        send(lobby.host, { t: 'err', msg: 'Lobby expired. Create a new code to continue.' });
      }
    }
  }
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { leaveLobby(ws, true); return ws.terminate(); }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crash It running at http://localhost:${PORT}`);
});
