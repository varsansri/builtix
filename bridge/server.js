import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const SESSION_BASE = path.join(process.env.HOME || '/root', '.builtrix-sessions')
const SESSION_IDLE_MS = 30 * 60 * 1000  // 30 min idle → kill session

// ── Session dir ──────────────────────────────────────────────────────

async function sessionDir(id) {
  const d = path.join(SESSION_BASE, id.replace(/[^a-z0-9_-]/gi, '_'))
  await fs.mkdir(d, { recursive: true })
  return d
}

// ── ANSI strip ───────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[mGKHFJA-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

// ── Live bash streaming ──────────────────────────────────────────────

function streamBashLive(command, cwd, send) {
  const env = { ...process.env, PYTHONUNBUFFERED: '1', PWD: cwd }
  const child = spawn('bash', ['-c', command], { cwd, env })
  let buf = ''

  function flush(data) {
    buf += data.toString()
    const parts = buf.split('\n'); buf = parts.pop()
    for (const line of parts) send({ type: 'bash_line', text: line })
  }

  child.stdout.on('data', flush)
  child.stderr.on('data', flush)
  child.on('close', () => { if (buf.trim()) send({ type: 'bash_line', text: buf }) })
  child.on('error', err => send({ type: 'bash_line', text: `✗ ${err.message}` }))
}

// ── System prompt — no internals exposed ─────────────────────────────

const SYSTEM_APPEND = `
You are Builtrix — a powerful AI terminal running inside Ubuntu (proot) on an Android phone (Termux).
You run real Linux: python3, node, gcc, git, apt, curl all work.
Build, code, run, install — anything the user asks.
Files you create are saved in this session folder.

ENVIRONMENT:
- OS: Ubuntu Linux (proot) inside Termux on Android
- Architecture: ARM64 (aarch64)
- No GUI, no display, no audio hardware
- Users talk to you from a mobile web browser — NOT a terminal
- The browser renders your text and speaks it via text-to-speech
- You can install packages with apt or pip

INPUT/OUTPUT — HOW IT WORKS:
- Users type in a chat text box on their phone browser
- Your text response streams line by line into a terminal-style UI
- There is NO real-time keyboard input to you — only text messages
- Arrow keys, ESC, Ctrl on the browser control the built-in UI (not you)
- You CANNOT make interactive terminal apps (ncurses, curses, input() loops)
- Do NOT use: curses, blessed, termios, raw input, interactive CLI tools

CHOICES & OPTIONS — CRITICAL RULE:
Whenever you need the user to make a decision or pick an option, ALWAYS use
this numbered text format — never arrow keys, never TUI menus:

  Choose:
  1. Option one
  2. Option two
  3. Option three

Then WAIT for the user to reply with a number (1, 2, 3…).
This applies to: confirmations, installs, file overwrites, choices, everything.
NEVER ask "press y/n" — use numbered options only.

BUILT-IN BROWSER FEATURES (already exist, tell users about these):
- /dragon → built-in snake game with real arrow key control (plays LIVE in this chat!)
- /clear  → clear screen
- /ls     → list files
- /help   → show all commands
- Voice input (microphone button) — users can speak to you
- TTS — browser reads your responses aloud

CRITICAL — SNAKE GAME RULE:
If anyone asks for snake, dragon, or any live in-chat game — ALWAYS say:
  Type /dragon to play live in this chat!
  Arrow keys move the snake in real time.
NEVER say you cannot do it. NEVER create an HTML file for snake requests.
/dragon IS the working live snake game. It is already built into the chat UI.

INTERACTIVE APPS & GAMES — UI INJECTION SYSTEM:
You can inject a LIVE interactive UI directly into the chat for this session.
It appears as an overlay in the user's chat — no separate tab needed.
When the user opens a new chat or tab, the overlay auto-disappears. Core UI stays forever.

To inject UI, output EXACTLY this format (nothing else on those marker lines):
UI_INJECT_START
<!DOCTYPE html><html>...your full self-contained HTML/JS/CSS here...</html>
UI_INJECT_END

Rules for injected HTML:
- Must be 100% self-contained (no external URLs, inline all CSS and JS)
- Use keyboard event listeners (keydown) for games — they work in the overlay
- Dark background (#0a0a0a), green (#00ff00) accent to match Builtix style
- For snake/games: use requestAnimationFrame or setInterval for game loop
- Speed, score, difficulty — all controllable via JS inside the HTML
- Include on-screen controls for mobile users (touch buttons for arrow keys)

Example uses: snake game, calculator, drawing canvas, timer, any visual tool
After injecting, say: "↳ Game loaded — use arrow keys or on-screen buttons to play"

AUDIO: Do NOT use espeak, aplay, mpg123, paplay, or any audio bash commands.
No audio device exists. If asked to speak: respond in text. The browser speaks it via TTS.

LIVE OUTPUT:
For timed/delayed output use shell directly:
  for i in $(seq 1 10); do echo $i; sleep 1; done
Always use PYTHONUNBUFFERED=1 before python commands.

FORMAT:
● [task description]
  ↳ [step]
  ↳ [step]

After done:
────────────────────────────────
✓ Done — [summary]
────────────────────────────────

No markdown. Lines under 50 chars. Symbols: ● ↳ ✓ ✗ ⚠ →`

// ── Per-session isolated Claude processes ────────────────────────────
// Each sessionId gets its own Claude process + conversation context.
// Sessions auto-expire after SESSION_IDLE_MS of inactivity.

const sessions = new Map()

function getSession(sessionId, sd) {
  if (!sessions.has(sessionId)) {
    const s = {
      proc: null,
      ready: false,
      queue: [],
      active: null,
      outBuf: '',
      seenToolIds: new Set(),
      idleTimer: null,
      sd,
    }
    sessions.set(sessionId, s)
    spawnClaude(sessionId, s)
  }
  const s = sessions.get(sessionId)
  if (sd) s.sd = sd
  // Reset idle timer on every request
  if (s.idleTimer) clearTimeout(s.idleTimer)
  s.idleTimer = setTimeout(() => cleanupSession(sessionId), SESSION_IDLE_MS)
  return s
}

function cleanupSession(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return
  try { s.proc.kill() } catch {}
  sessions.delete(sessionId)
  console.log(`[bridge] session ${sessionId.slice(0, 12)} expired — ${sessions.size} active`)
}

function spawnClaude(sessionId, s) {
  s.ready = false
  s.outBuf = ''
  s.seenToolIds = new Set()
  s.uiBuffer = null  // collects UI_INJECT HTML between markers

  s.proc = spawn('claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Bash,Write,Read,Edit,Glob,Grep,WebFetch,WebSearch',
    '--append-system-prompt', SYSTEM_APPEND,
  ], {
    cwd: s.sd || __dirname,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const tag = sessionId.slice(0, 12)
  s.proc.stdout.on('data', chunk => onData(sessionId, s, chunk))
  s.proc.stderr.on('data', d => {
    const t = stripAnsi(d.toString()).trim()
    if (t && !t.includes('Warning') && !t.includes('stdin')) console.error(`[cc:${tag}]`, t)
  })
  s.proc.on('exit', code => {
    console.log(`[bridge] ${tag} exited (${code})`)
    if (sessions.has(sessionId)) {
      s.ready = false
      setTimeout(() => { if (sessions.has(sessionId)) spawnClaude(sessionId, s) }, 1000)
    }
  })
  s.proc.on('error', err => {
    console.error(`[bridge] spawn error (${tag}):`, err.message)
    setTimeout(() => { if (sessions.has(sessionId)) spawnClaude(sessionId, s) }, 2000)
  })

  // Warmup: trigger init handshake
  writeMsg(s, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '.' }] } })
  console.log(`[bridge] ${tag} starting…`)
}

function writeMsg(s, obj) {
  s.proc.stdin.write(JSON.stringify(obj) + '\n')
}

function onData(sessionId, s, chunk) {
  s.outBuf += chunk.toString()
  const lines = s.outBuf.split('\n')
  s.outBuf = lines.pop()

  for (const line of lines) {
    if (!line.trim()) continue
    let ev; try { ev = JSON.parse(line) } catch { continue }

    if (ev.type === 'system' && ev.subtype === 'init') {
      console.log(`[bridge] ${sessionId.slice(0, 12)} session:`, ev.session_id); continue
    }

    if (!s.ready && ev.type === 'result') {
      s.ready = true
      console.log(`[bridge] ${sessionId.slice(0, 12)} ready ✓`)
      drain(sessionId, s)
      continue
    }

    if (!s.active) continue
    const { send, sd } = s.active

    if (ev.type === 'rate_limit_event') continue

    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && block.text) {
          // Handle UI_INJECT markers — buffer HTML between START/END
          const lines = block.text.split('\n')
          const filtered = []
          for (const line of lines) {
            if (line.trim() === 'UI_INJECT_START') { s.uiBuffer = []; continue }
            if (line.trim() === 'UI_INJECT_END') {
              if (s.uiBuffer !== null) {
                send({ type: 'ui_inject', html: s.uiBuffer.join('\n') })
                s.uiBuffer = null
              }
              continue
            }
            if (s.uiBuffer !== null) { s.uiBuffer.push(line); continue }
            filtered.push(line)
          }
          const out = filtered.join('\n')
          if (out.trim()) send({ type: 'text', text: out })
        }
        if (block.type === 'tool_use' && !s.seenToolIds.has(block.id)) {
          s.seenToolIds.add(block.id)
          const inp = block.input || {}
          const first = Object.entries(inp)[0]
          const preview = first ? `${first[0]}: "${String(first[1]).slice(0, 35)}"` : ''
          send({ type: 'text', text: `→ ${block.name}(${preview})` })

          if (block.name === 'Bash' && inp.command) {
            streamBashLive(inp.command, sd, send)
          }
        }
      }
    }

    if (ev.type === 'user' && ev.tool_use_result) {
      const { stderr } = ev.tool_use_result
      if (stderr?.trim()) {
        stderr.split('\n').forEach(l => send({ type: 'bash_line', text: `err: ${l}` }))
      }
    }

    if (ev.type === 'user' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && block.content) {
          const name = s.active?.lastToolName
          if (name && name !== 'Bash') {
            send({ type: 'tool_result', text: String(block.content).slice(0, 200) })
          }
        }
      }
    }

    if (ev.type === 'result') {
      send({ type: 'done' })
      s.active.resolve()
      s.active = null
      drain(sessionId, s)
    }
  }
}

function drain(sessionId, s) {
  if (s.active || !s.queue.length || !s.ready) return
  s.active = s.queue.shift()
  const last = s.active.messages.filter(m => m.role === 'user').pop()
  writeMsg(s, {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: last?.content || '' }] },
  })
}

// ── HTTP server ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  req.socket.setNoDelay(true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mode: 'per-session-isolated', version: '5.1', sessions: sessions.size }))
    return
  }

  // ── Static file serving — /files/:sessionId/:filename ──────────────
  const fileMatch = req.url?.match(/^\/files\/([^/]+)\/(.+)$/)
  if (req.method === 'GET' && fileMatch) {
    const [, sid, filename] = fileMatch
    const safeName = path.basename(filename)
    const filePath = path.join(SESSION_BASE, sid.replace(/[^a-z0-9_-]/gi, '_'), safeName)
    try {
      const data = await fs.readFile(filePath)
      const ext = safeName.split('.').pop().toLowerCase()
      const mime = { html: 'text/html', js: 'application/javascript', css: 'text/css',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' })
      res.end(data)
    } catch {
      res.writeHead(404); res.end('Not found')
    }
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', c => body += c)
    await new Promise(r => req.on('end', r))
    let parsed; try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }

    const { messages = [], sessionId = 'default' } = parsed
    const sd = await sessionDir(sessionId)
    const s = getSession(sessionId, sd)

    // Log incoming request
    const last = messages.filter(m => m.role === 'user').pop()
    const preview = String(last?.content || '').slice(0, 80).replace(/\n/g, ' ')
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[req] ${ts} session:${sessionId.slice(0, 12)} msg:"${preview}"`)


    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    res.flushHeaders()

    const send = d => {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(d)}\n\n`)
        if (res.socket) res.socket.setNoDelay(true)
      }
    }

    if (!s.ready) {
      send({ type: 'text', text: '⚠ Starting session…' })
      await new Promise((resolve, reject) => {
        const t = setInterval(() => { if (s.ready) { clearInterval(t); resolve() } }, 500)
        setTimeout(() => { clearInterval(t); reject() }, 30000)
      }).catch(() => {
        send({ type: 'text', text: '✗ Session failed to start' })
        send({ type: 'done' })
        res.end()
      })
      if (!s.ready) return
    }

    await new Promise(resolve => {
      s.queue.push({ messages, sd, send, resolve })
      drain(sessionId, s)
    })

    if (!res.destroyed) res.end()
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Builtrix bridge v5.0 on http://localhost:${PORT}`)
})
