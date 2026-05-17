# Biyatrix

**A mobile-first AI terminal. Build, code, and run real programs from your phone browser.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/varsansri/biyatrix&env=GROQ_KEY_1,GROQ_KEY_2,GROQ_KEY_3,GROQ_KEY_4&envDescription=Groq%20API%20keys%20for%20auto-rotation%20when%20one%20hits%20rate%20limits&envLink=https://console.groq.com/keys&project-name=biyatrix&repository-name=biyatrix-deploy)

Live: [biyatrix.vercel.app](https://biyatrix.vercel.app)

---

## How it works

Biyatrix has two modes that switch automatically:

### Mode 1 — Cloud (always available)

```
Your browser → Vercel → Groq AI (llama-3.3-70b)
```

When no bridge is connected, the site runs entirely in the cloud.
Groq handles the AI. Code execution runs on Piston (sandboxed cloud runner).
4 Groq API keys rotate automatically when one hits its rate limit.

---

### Mode 2 — Bridge (your phone becomes the server)

```
Your browser → Vercel → Your Phone (Termux/Ubuntu) → Claude Code CLI
```

When you run the bridge on your Android phone (Termux), the site upgrades to real Linux execution.
Your phone becomes the compute node. Vercel is just the UI.

**What runs on your phone:**
- A Node.js server (`bridge/server.js`) on port 3001
- 3 Cloudflare tunnels for redundancy — if one dies, traffic switches to another in 20 seconds
- The active tunnel URL is stored in Upstash Redis so Vercel always knows where your phone is
- Claude Code CLI (`claude`) runs inside Ubuntu (proot) — real bash, apt, python3, git, everything
- Each user session gets its own isolated folder and its own Claude process
- Sessions auto-expire after 30 minutes of inactivity
- Auto-pulls latest code from GitHub every 5 minutes and restarts

**What you get in bridge mode:**
- Real terminal on your Android phone — no sandbox, no limits
- `apt install`, `pip install`, `gcc`, `git`, `curl` — all work
- Files persist in `~/.builtrix-sessions/<sessionId>/` during the session

---

## Features

- Streaming output — see every step as it happens
- Voice input — tap mic, speak, send
- File attachments — pick any file from your phone
- UI injection — Claude can push live HTML/JS apps (games, tools) directly into the chat
- `/dragon` — built-in snake game playable with arrow keys inside the chat
- `/clear`, `/ls`, `/help` — built-in commands

---

## Deploy your own (Cloud mode)

1. Click **Deploy with Vercel** above
2. Log in with GitHub
3. Enter 4 Groq API keys (get them free at [console.groq.com/keys](https://console.groq.com/keys))
4. Click Deploy

Your site is live in ~60 seconds at `your-name.vercel.app`

---

## Enable Bridge mode (real Linux on your phone)

Requirements: Android phone with [Termux](https://termux.dev) + Ubuntu via proot-distro + Claude Code CLI installed.

```bash
# Inside Ubuntu in Termux
cd ~/builtix/bridge
bash start.sh
```

The script will:
1. Install `cloudflared` if missing
2. Start the bridge server on port 3001
3. Open 3 Cloudflare tunnels
4. Register the active tunnel URL with your Vercel deployment
5. Run a watchdog that auto-failovers and auto-restarts if anything dies

Keep the terminal open. Your site is now running on your phone.

To connect the bridge to your Vercel deployment, set this environment variable in Vercel:

```
BRIDGE_TOKEN=biyatrix-bridge
```

And add Upstash Redis credentials:
```
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

---

## Run locally (development)

```bash
npm install

# Terminal 1 — backend
npm run dev:backend

# Terminal 2 — frontend
npm run dev:frontend
```

Open `http://localhost:5173`

---

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React + Vite + xterm.js |
| Cloud AI | Groq (llama-3.3-70b) |
| Bridge AI | Claude Code CLI (Anthropic) |
| Tunnel | Cloudflare (cloudflared) |
| URL registry | Upstash Redis |
| Hosting | Vercel |
| Code execution (cloud) | Piston API |
