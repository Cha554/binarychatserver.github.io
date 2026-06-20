// server.js — BinaryChat relay server
// Stores accounts + friend graph. Never sees plaintext messages or passwords
// (passwords are hashed; messages are end-to-end encrypted by clients).

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DB_FILE = path.join(__dirname, 'users.json');
const QUEUE_FILE = path.join(__dirname, 'pending.json');

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = loadJSON(DB_FILE, {});
let pending = loadJSON(QUEUE_FILE, {}); // username -> [queued encrypted messages]

function persistUsers() { saveJSON(DB_FILE, users); }
function persistPending() { saveJSON(QUEUE_FILE, pending); }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

const wss = new WebSocket.Server({ port: PORT });
console.log(`BinaryChat server listening on ws://0.0.0.0:${PORT}`);

const online = new Map(); // username -> ws

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastStatus(username, isOnline) {
  const user = users[username];
  if (!user) return;
  for (const friend of user.friends) {
    const fws = online.get(friend);
    if (fws) send(fws, { type: 'online_status', username, online: isOnline });
  }
}

wss.on('connection', (ws) => {
  ws.username = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: 'bad json' }); }

    switch (msg.type) {
      case 'register': {
        const { username, password, publicKey } = msg;
        if (!username || !password || !publicKey) return send(ws, { type: 'register_err', message: 'missing fields' });
        if (users[username]) return send(ws, { type: 'register_err', message: 'username taken' });
        const { salt, hash } = hashPassword(password);
        users[username] = { salt, hash, publicKey, friends: [], incoming: [], outgoing: [] };
        persistUsers();
        send(ws, { type: 'register_ok' });
        break;
      }
      case 'login': {
        const { username, password, publicKey } = msg;
        const user = users[username];
        if (!user || !verifyPassword(password, user.salt, user.hash)) {
          return send(ws, { type: 'login_err', message: 'invalid credentials' });
        }
        if (publicKey) { user.publicKey = publicKey; persistUsers(); }
        ws.username = username;
        online.set(username, ws);
        send(ws, {
          type: 'login_ok',
          friends: user.friends,
          incoming: user.incoming,
          outgoing: user.outgoing
        });
        const q = pending[username] || [];
        for (const m of q) send(ws, { type: 'message', from: m.from, ciphertext: m.ciphertext, nonce: m.nonce, ts: m.ts });
        pending[username] = [];
        persistPending();
        broadcastStatus(username, true);
        break;
      }
      case 'add_friend': {
        const me = ws.username; if (!me) return;
        const target = msg.target;
        if (!users[target]) return send(ws, { type: 'error', message: 'no such user' });
        if (target === me) return send(ws, { type: 'error', message: 'cannot add yourself' });
        const meUser = users[me], targetUser = users[target];
        if (meUser.friends.includes(target)) return send(ws, { type: 'error', message: 'already friends' });
        if (!meUser.outgoing.includes(target)) meUser.outgoing.push(target);
        if (!targetUser.incoming.includes(me)) targetUser.incoming.push(me);
        persistUsers();
        const tws = online.get(target);
        if (tws) send(tws, { type: 'friend_request', from: me });
        send(ws, { type: 'request_sent', target });
        break;
      }
      case 'accept_friend': {
        const me = ws.username; if (!me) return;
        const target = msg.target;
        const meUser = users[me], targetUser = users[target];
        if (!meUser || !targetUser) return;
        meUser.incoming = meUser.incoming.filter(u => u !== target);
        targetUser.outgoing = targetUser.outgoing.filter(u => u !== me);
        if (!meUser.friends.includes(target)) meUser.friends.push(target);
        if (!targetUser.friends.includes(me)) targetUser.friends.push(me);
        persistUsers();
        send(ws, { type: 'friend_accepted', with: target });
        const tws = online.get(target);
        if (tws) send(tws, { type: 'friend_accepted', with: me });
        break;
      }
      case 'list_friends': {
        const me = ws.username; if (!me) return;
        const meUser = users[me];
        send(ws, { type: 'friends_list', friends: meUser.friends, incoming: meUser.incoming, outgoing: meUser.outgoing });
        break;
      }
      case 'get_pubkey': {
        const target = msg.target;
        const t = users[target];
        if (!t) return send(ws, { type: 'error', message: 'no such user' });
        send(ws, { type: 'pubkey', username: target, publicKey: t.publicKey });
        break;
      }
      case 'message': {
        const me = ws.username; if (!me) return;
        const { to, ciphertext, nonce } = msg;
        if (!users[me] || !users[me].friends.includes(to)) return send(ws, { type: 'error', message: 'not friends' });
        const payload = { type: 'message', from: me, ciphertext, nonce, ts: Date.now() };
        const tws = online.get(to);
        if (tws) {
          send(tws, payload);
        } else {
          pending[to] = pending[to] || [];
          pending[to].push({ from: me, ciphertext, nonce, ts: payload.ts });
          persistPending();
        }
        break;
      }
      default:
        send(ws, { type: 'error', message: 'unknown type' });
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      online.delete(ws.username);
      broadcastStatus(ws.username, false);
    }
  });
});
