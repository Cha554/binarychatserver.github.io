#!/usr/bin/env node
// client.js — BinaryChat client
// Generates a local keypair (kept only on your machine), logs into the relay
// server, and end-to-end encrypts every message with the recipient's public
// key (nacl.box = X25519 + XSalsa20-Poly1305). The server only ever sees
// ciphertext.

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nacl = require('tweetnacl');
const naclutil = require('tweetnacl-util');

// If something goes wrong before/outside the normal flow, print it and wait
// for a keypress instead of letting the window vanish (matters most for
// people double-clicking the .exe on Windows, where the console closes the
// instant the process exits).
function pauseThenExit(code) {
  console.log('\nPress Enter to close this window...');
  try {
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(code));
  } catch {
    process.exit(code);
  }
}
process.on('uncaughtException', (err) => {
  console.log('\n[fatal error]', err && err.message ? err.message : err);
  pauseThenExit(1);
});
process.on('unhandledRejection', (err) => {
  console.log('\n[fatal error]', err && err.message ? err.message : err);
  pauseThenExit(1);
});

const CONFIG_DIR = path.join(os.homedir(), '.binarychat');
const KEY_FILE = path.join(CONFIG_DIR, 'keys.json');
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadOrCreateKeys() {
  if (fs.existsSync(KEY_FILE)) {
    const data = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    return {
      publicKey: naclutil.decodeBase64(data.publicKey),
      secretKey: naclutil.decodeBase64(data.secretKey),
      publicKeyB64: data.publicKey
    };
  }
  const kp = nacl.box.keyPair();
  const data = {
    publicKey: naclutil.encodeBase64(kp.publicKey),
    secretKey: naclutil.encodeBase64(kp.secretKey)
  };
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2));
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, publicKeyB64: data.publicKey };
}

const keys = loadOrCreateKeys();
const peerKeys = {}; // username -> Uint8Array public key

const args = process.argv.slice(2);
const serverArg = args.find(a => a.startsWith('--server='));
const SERVER_URL = serverArg ? serverArg.split('=')[1] : (process.env.CHAT_SERVER || 'ws://localhost:8080');

console.log('========================================');
console.log('  BinaryChat — end-to-end encrypted CLI');
console.log('========================================');
console.log(`Connecting to ${SERVER_URL} ...`);

const ws = new WebSocket(SERVER_URL);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

function safeSend(obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else {
    console.log('[!] still connecting, please wait a moment and try again');
  }
}

function help() {
  console.log(`
Commands:
  /register <user> <pass>   create an account
  /login <user> <pass>      log in
  /add <user>               send a friend request
  /accept <user>            accept a friend request
  /friends                  list friends & pending requests
  /msg <user> <text...>     send an encrypted message
  /help                     show this help
  /quit                     exit
`);
}

ws.on('open', () => { help(); rl.prompt(); });

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case 'register_ok': console.log('[ok] account created — now run /login'); break;
    case 'register_err': console.log('[error]', msg.message); break;
    case 'login_ok':
      console.log(`[ok] logged in. Friends: ${msg.friends.join(', ') || '(none yet)'}`);
      if (msg.incoming.length) console.log(`Pending friend requests from: ${msg.incoming.join(', ')}`);
      break;
    case 'login_err': console.log('[error]', msg.message); break;
    case 'friend_request': console.log(`\n[friend request] ${msg.from} wants to add you — use /accept ${msg.from}`); break;
    case 'request_sent': console.log(`[ok] friend request sent to ${msg.target}`); break;
    case 'friend_accepted': console.log(`\n[friends] you and ${msg.with} are now friends — try /msg ${msg.with} hello`); break;
    case 'friends_list':
      console.log(`Friends: ${msg.friends.join(', ') || '(none)'}`);
      console.log(`Incoming requests: ${msg.incoming.join(', ') || '(none)'}`);
      console.log(`Outgoing requests: ${msg.outgoing.join(', ') || '(none)'}`);
      break;
    case 'pubkey':
      if (msg.publicKey) peerKeys[msg.username] = naclutil.decodeBase64(msg.publicKey);
      break;
    case 'message': {
      const senderKey = peerKeys[msg.from];
      if (!senderKey) {
        ws.send(JSON.stringify({ type: 'get_pubkey', target: msg.from }));
        console.log(`\n[!] message from ${msg.from} received, fetching their key — it will appear shortly`);
        break;
      }
      const nonce = naclutil.decodeBase64(msg.nonce);
      const ciphertext = naclutil.decodeBase64(msg.ciphertext);
      const plain = nacl.box.open(ciphertext, nonce, senderKey, keys.secretKey);
      const text = plain ? naclutil.encodeUTF8(plain) : '[decryption failed]';
      console.log(`\n${msg.from}: ${text}`);
      break;
    }
    case 'online_status':
      console.log(`\n[status] ${msg.username} is ${msg.online ? 'online' : 'offline'}`);
      break;
    case 'error': console.log('[error]', msg.message); break;
  }
  rl.prompt();
});

let manualQuit = false;

ws.on('close', () => {
  if (manualQuit) { process.exit(0); return; }
  console.log('\nDisconnected from server.');
  console.log(`(Tried to connect to: ${SERVER_URL})`);
  console.log('If this happened immediately, the most likely causes are:');
  console.log('  1. No server is running at that address');
  console.log('  2. You need to pass --server=ws://your-server:8080 (or wss://... for a hosted one)');
  console.log('  3. A firewall is blocking the connection');
  pauseThenExit(1);
});
ws.on('error', (e) => {
  console.log('\n[connection error]', e.message);
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return rl.prompt();
  const [cmd, ...rest] = trimmed.split(' ');

  switch (cmd) {
    case '/help': help(); break;
    case '/register': {
      const [user, pass] = rest;
      if (!user || !pass) { console.log('usage: /register <user> <pass>'); break; }
      safeSend(({ type: 'register', username: user, password: pass, publicKey: keys.publicKeyB64 }));
      break;
    }
    case '/login': {
      const [user, pass] = rest;
      if (!user || !pass) { console.log('usage: /login <user> <pass>'); break; }
      safeSend(({ type: 'login', username: user, password: pass, publicKey: keys.publicKeyB64 }));
      break;
    }
    case '/add': {
      const [target] = rest;
      if (!target) { console.log('usage: /add <user>'); break; }
      safeSend(({ type: 'add_friend', target }));
      break;
    }
    case '/accept': {
      const [target] = rest;
      if (!target) { console.log('usage: /accept <user>'); break; }
      safeSend(({ type: 'accept_friend', target }));
      break;
    }
    case '/friends':
      safeSend(({ type: 'list_friends' }));
      break;
    case '/msg': {
      const [target, ...words] = rest;
      const text = words.join(' ');
      if (!target || !text) { console.log('usage: /msg <user> <text>'); break; }
      if (!peerKeys[target]) {
        safeSend(({ type: 'get_pubkey', target }));
        console.log('[fetching key — resend your message in a second]');
        break;
      }
      const nonce = nacl.randomBytes(24);
      const plain = naclutil.decodeUTF8(text);
      const box = nacl.box(plain, nonce, peerKeys[target], keys.secretKey);
      safeSend(({
        type: 'message',
        to: target,
        ciphertext: naclutil.encodeBase64(box),
        nonce: naclutil.encodeBase64(nonce)
      }));
      console.log(`(you -> ${target}): ${text}`);
      break;
    }
    case '/quit': manualQuit = true; ws.close(); process.exit(0); break;
    default: console.log('unknown command — /help for the list');
  }
  rl.prompt();
});
