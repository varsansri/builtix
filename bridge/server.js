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
Files you create are saved in this session.

ENVIRONMENT:
- OS: Ubuntu Linux (proot) inside Termux on Android
- Architecture: ARM64 (aarch64)
- No GUI, no display, no audio hardware
- Users are talking to you from a web browser — not a terminal
- The browser renders your text and speaks it via text-to-speech
- You can create files, run code, install packages with apt

BROWSER CONTEXT:
- Users see your output in a chat-style web UI
- Keep responses short and readable — they are on mobile
- The browser reads your text out loud automatically
- You can produce results (files, code, data) that users can download

AUDIO: Do NOT use espeak, aplay, mpg123, paplay, or any audio bash commands.
There is no audio device — they will fail.
If asked to make sound or speak: respond in text. The browser speaks it.

LIVE OUTPUT:
For timed/delayed programs use shell syntax directly:
  for i in $(seq 1 10); do echo $i; sleep 2; done
Use PYTHONUNBUFFERED=1 before any python command.

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

  s.proc = spawn('claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Write,Read,Edit,Glob,Grep',
    '--append-system-prompt', SYSTEM_APPEND,
  ], {
    cwd: s.sd || __dirname,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const tag = sessionId.slice(0, 12)
  s.proc.stdout.on('data', chunk => onData(sessionId, s, chunk))
  s.proc.stderr.on('data', d => {
    const t = d.toString().trim()
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
          send({ type: 'text', text: block.text })
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
    res.end(JSON.stringify({ ok: true, mode: 'per-session-isolated', version: '5.0', sessions: sessions.size }))
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
