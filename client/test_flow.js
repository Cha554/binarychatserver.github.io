const WebSocket = require('ws');
const nacl = require('tweetnacl');
const naclutil = require('tweetnacl-util');

function makeUser(name) {
  const kp = nacl.box.keyPair();
  return { name, kp, pubB64: naclutil.encodeBase64(kp.publicKey) };
}

const alice = makeUser('alice');
const bob = makeUser('bob');

function connect(user) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.peerKeys = {};
    ws.on('open', () => resolve(ws));
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

async function main() {
  const aWs = await connect(alice);
  const bWs = await connect(bob);

  let bobGotRequest = false;
  let aliceGotFriendAccepted = false;
  let bobDecrypted = null;

  bWs.on('message', (raw) => {
    const m = JSON.parse(raw);
    console.log('[bob recv]', m.type);
    if (m.type === 'friend_request') bobGotRequest = true;
    if (m.type === 'pubkey') bWs.peerKeys[m.username] = naclutil.decodeBase64(m.publicKey);
    if (m.type === 'message') {
      const senderKey = bWs.peerKeys[m.from];
      const nonce = naclutil.decodeBase64(m.nonce);
      const ct = naclutil.decodeBase64(m.ciphertext);
      const plain = nacl.box.open(ct, nonce, senderKey, bob.kp.secretKey);
      bobDecrypted = naclutil.encodeUTF8(plain);
    }
  });

  aWs.on('message', (raw) => {
    const m = JSON.parse(raw);
    console.log('[alice recv]', m.type);
    if (m.type === 'friend_accepted') aliceGotFriendAccepted = true;
    if (m.type === 'pubkey') aWs.peerKeys[m.username] = naclutil.decodeBase64(m.publicKey);
  });

  // register
  send(aWs, { type: 'register', username: 'alice', password: 'pw123', publicKey: alice.pubB64 });
  send(bWs, { type: 'register', username: 'bob', password: 'pw123', publicKey: bob.pubB64 });
  await new Promise(r => setTimeout(r, 300));

  // login
  send(aWs, { type: 'login', username: 'alice', password: 'pw123', publicKey: alice.pubB64 });
  send(bWs, { type: 'login', username: 'bob', password: 'pw123', publicKey: bob.pubB64 });
  await new Promise(r => setTimeout(r, 300));

  // alice adds bob
  send(aWs, { type: 'add_friend', target: 'bob' });
  await new Promise(r => setTimeout(r, 300));

  // bob accepts
  send(bWs, { type: 'accept_friend', target: 'alice' });
  await new Promise(r => setTimeout(r, 300));
  send(bWs, { type: 'get_pubkey', target: 'alice' });
  await new Promise(r => setTimeout(r, 200));

  // alice fetches bob's pubkey then sends encrypted message
  send(aWs, { type: 'get_pubkey', target: 'bob' });
  await new Promise(r => setTimeout(r, 200));

  const nonce = nacl.randomBytes(24);
  const plaintext = naclutil.decodeUTF8('hello bob, this is a secret');
  const box = nacl.box(plaintext, nonce, aWs.peerKeys['bob'], alice.kp.secretKey);
  send(aWs, { type: 'message', to: 'bob', ciphertext: naclutil.encodeBase64(box), nonce: naclutil.encodeBase64(nonce) });

  // wait for delivery — bob needs alice's pubkey too
  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== RESULTS ===');
  console.log('bob got friend request:', bobGotRequest);
  console.log('alice got friend_accepted:', aliceGotFriendAccepted);
  console.log('bob decrypted message:', bobDecrypted);

  const pass = bobGotRequest && aliceGotFriendAccepted && bobDecrypted === 'hello bob, this is a secret';
  console.log(pass ? '\nALL TESTS PASSED' : '\nTEST FAILED');
  process.exit(pass ? 0 : 1);
}

main();
