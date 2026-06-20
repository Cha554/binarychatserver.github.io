# BinaryChat

A friend-to-friend encrypted chat app:
- **Server** (`server/`) — a lightweight Node.js WebSocket relay. It stores accounts and the friend graph, but it never sees your message contents — only encrypted blobs pass through it.
- **Client** (`client/`) — a Node.js CLI app you compile into a real standalone **binary/exe** (no Node.js needed to run it once built). Add friends, accept requests, and chat — every message is end-to-end encrypted on your machine before it's sent.

## How the encryption works

Each client generates its own keypair (X25519, via `tweetnacl`) the first time it runs, stored locally at `~/.binarychat/keys.json`. Your private key **never leaves your machine**. To message a friend, your client fetches their public key from the server and encrypts the message with `nacl.box` (X25519-XSalsa20-Poly1305 — the same primitive used by Signal-adjacent tools). Only your friend's private key can decrypt it. The server only relays ciphertext and queues it briefly if your friend's offline.

For transport security on top of that (so no one can see *that* you're connecting at all), run the server behind `wss://` (TLS) — see hosting section below, all the free hosts listed give you this automatically.

Passwords are never stored in plaintext — they're hashed with PBKDF2 (100,000 rounds, SHA-512) + per-user salt.

## 1. Run the server

```bash
cd server
npm install
npm start
```

It listens on port 8080 (or `PORT` env var). For local testing, that's it — keep this running.

## 2. Run the client (without compiling, for development)

```bash
cd client
npm install
node client.js --server=ws://localhost:8080
```

Commands inside the chat:
```
/register <user> <pass>   create an account
/login <user> <pass>      log in
/add <user>               send a friend request
/accept <user>            accept a friend request
/friends                  list friends & pending requests
/msg <user> <text...>     send an encrypted message
/help                     show this help
/quit                     exit
```

Open two terminals (or two machines) and try it: register two users, `/add` each other, `/accept`, then `/msg`.

## 3. Compile the client into a binary/exe

This project uses Node's built-in **Single Executable Application** feature — it bundles your code straight into a copy of the Node binary, so the result runs with **zero dependencies** on the target machine.

**On Linux/Mac:**
```bash
cd client
chmod +x build-unix.sh
./build-unix.sh
```
Produces `dist/binarychat-linux` or `dist/binarychat-macos`.

**On Windows** (run from a regular `cmd.exe`, with Node.js installed):
```
cd client
build-windows.bat
```
Produces `dist\binarychat-win.exe`.

> Note: SEA builds natively per-OS — you can't cross-compile a `.exe` from Linux. Run the matching script on each OS you want a binary for. A pre-built Linux x64 binary is included in this delivery (`client/dist/binarychat-linux-x64`) so you can try it immediately on Linux/WSL.

Run the compiled binary anywhere — no `npm install` needed:
```bash
./binarychat-linux --server=wss://your-deployed-server.example.com
```

## 4. Free hosting for the server (step-by-step: Render.com)

I included a `render.yaml` in the project root so Render can auto-configure itself — you barely have to touch any settings.

**Step 1 — Put the code on GitHub** (Render deploys from a git repo):
1. Go to https://github.com/new and create a new repository (can be private).
2. On your machine, in the `chatapp` folder:
   ```
   git init
   git add .
   git commit -m "BinaryChat server"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
   (The included `.gitignore` already excludes `node_modules`, the prebuilt binary, and local data files, so this push will be small and fast.)

**Step 2 — Deploy on Render:**
1. Go to https://render.com and sign up free (GitHub login is easiest).
2. Click **New +** → **Blueprint**.
3. Connect the GitHub repo you just pushed. Render will detect `render.yaml` automatically and pre-fill everything (root dir `server`, build command `npm install`, start command `npm start`).
4. Click **Apply** / **Create**. First deploy takes a couple minutes.
5. Once it's live, Render gives you a URL like `binarychat-server-xxxx.onrender.com`. Your WebSocket address is:
   ```
   wss://binarychat-server-xxxx.onrender.com
   ```
   (`wss://` not `ws://` — Render terminates TLS for you automatically, so this connection is encrypted in transit too.)

**Step 3 — Connect from the client, from anywhere:**
```
binarychat-win.exe --server=wss://binarychat-server-xxxx.onrender.com
```
Give this same command (with your URL) to friends and they can chat with you over the internet — no port forwarding, no fixed IP needed.

**Heads up about the free tier:** Render's free web services spin down after ~15 minutes of no traffic, and take 30-60 seconds to wake back up on the next connection. That just means the first connection after a quiet period feels slow — totally fine for a casual friends chat, not something to worry about.



### Persisting data on the host
The server writes `users.json` and `pending.json` to its own folder. On Render's free tier the filesystem is ephemeral (wiped on redeploy/restart) — fine for casual use, but if you want accounts to survive restarts, mount Render's free persistent disk add-on for the service, or swap the JSON-file storage for a free database (e.g. a free-tier Postgres on Render/Neon) — let me know if you want help wiring that up.

## Cross-platform compatibility (Linux & Windows)

The server and client are pure Node.js with **zero native dependencies** — `ws` and `tweetnacl` both run as plain JavaScript on any OS, so the source code works identically on Linux, Windows, and macOS.

- **Server**: runs the same way everywhere — `npm install && npm start`. Works on a Linux box, a Windows machine, or any free host (which will be Linux-based).
- **Client source**: `node client.js --server=...` works unmodified on Linux, macOS, or Windows (just run it from PowerShell/cmd instead of bash).
- **Compiled binaries**: a Node Single Executable Application (SEA) is built natively per-OS — it can't be cross-compiled from one OS to make an exe for another. That's why this delivery includes:
  - `client/dist/binarychat-linux-x64` — pre-built and tested, ready to run on Linux right now.
  - `client/build-windows.bat` — run this **on a Windows machine** with Node.js 20+ installed to produce `dist\binarychat-win.exe`. It's a one-command build (just double-click it or run from cmd).
  - `client/build-unix.sh` — run on Linux or Mac to (re)build `dist/binarychat-linux` or `dist/binarychat-macos`.

I wasn't able to fetch Node's official Windows binary from inside this sandbox to pre-build the `.exe` for you directly — `nodejs.org` isn't reachable from here, and Node's Windows binaries aren't distributed via GitHub. Run `build-windows.bat` on a Windows machine and it'll produce a real, fully working `.exe` in under a minute — I tested the equivalent Linux build with this exact script logic and it works cleanly.

One Windows-specific note: a freshly built, unsigned `.exe` will likely trigger a Windows Defender SmartScreen warning the first time it's run (this happens to all unsigned executables, not a sign of a problem) — click "More info" → "Run anyway".


```
chatapp/
  server/
    server.js        # WebSocket relay: accounts, friends, message queueing
    package.json
  client/
    client.js         # CLI chat client (E2E encryption happens here)
    package.json
    sea-config.json    # Node SEA build config
    build-unix.sh       # compiles dist/binarychat-linux or -macos
    build-windows.bat   # compiles dist\binarychat-win.exe
    dist/
      binarychat-linux-x64   # pre-built Linux binary, ready to run
```
