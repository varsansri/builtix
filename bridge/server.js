import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const SESSION_BASE = path.join(process.env.HOME || '/root', '.builtix-sessions')

// ── Session dir ──────────────────────────────────────────────────────

async function sessionDir(id) {
  const d = path.join(SESSION_BASE, id.replace(/[^a-z0-9_-]/gi, '_'))
  await fs.mkdir(d, { recursive: true })
  return d
}

// ── Live bash streaming (runs alongside Claude Code's internal runner) ─
// Claude Code buffers bash output. We spawn the same command ourselves
// to stream it live to the browser. Double-run is acceptable for most tasks.

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

// ── Persistent Claude Code process ───────────────────────────────────

const SYSTEM_APPEND = `
You are Builtix — an AI terminal running on an Android phone (Termux, Ubuntu proot).

ENVIRONMENT:
- Real Termux Ubuntu: python3, node, gcc, git, apt-get, pip, npm, curl all work
- You are on the user's phone — no cloud, full shell access
- Session working directory is where your files are saved

IMPORTANT — LIVE OUTPUT:
When you run Bash commands, the output streams LIVE to the user's screen.
For timed/delayed programs: use shell syntax directly in Bash:
  for i in $(seq 1 10); do echo $i; sleep 2; done
Do NOT write a Python script just to print with delays.
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

let claudeProc = null
let procReady = false
const queue = []
let active = null
let outBuf = ''
let seenToolIds = new Set()   // track tools we've already live-streamed

function spawnClaude() {
  procReady = false
  outBuf = ''
  seenToolIds = new Set()

  claudeProc = spawn('claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Write,Read,Edit,Glob,Grep',
    '--add-dir', '/root/builtix',
    '--append-system-prompt', SYSTEM_APPEND,
  ], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  claudeProc.stdout.on('data', onData)
  claudeProc.stderr.on('data', d => {
    const t = d.toString().trim()
    if (t && !t.includes('Warning') && !t.includes('stdin')) console.error('[cc]', t)
  })
  claudeProc.on('exit', code => {
    console.log(`[bridge] claude exited (${code}), restarting…`)
    procReady = false
    setTimeout(spawnClaude, 1000)
  })
  claudeProc.on('error', err => {
    console.error('[bridge] spawn error:', err.message)
    setTimeout(spawnClaude, 2000)
  })

  writeMsg({ type:'user', message:{ role:'user', content:[{ type:'text', text:'.' }] } })
  console.log('[bridge] claude starting…')
}

function writeMsg(obj) {
  claudeProc.stdin.write(JSON.stringify(obj) + '\n')
}

function onData(chunk) {
  outBuf += chunk.toString()
  const lines = outBuf.split('\n')
  outBuf = lines.pop()

  for (const line of lines) {
    if (!line.trim()) continue
    let ev; try { ev = JSON.parse(line) } catch { continue }

    // Init event
    if (ev.type === 'system' && ev.subtype === 'init') {
      console.log('[bridge] session:', ev.session_id); continue
    }

    // Warmup done → ready
    if (!procReady && ev.type === 'result') {
      procReady = true; console.log('[bridge] ready ✓'); drain(); continue
    }

    if (!active) continue
    const { send, sd } = active

    if (ev.type === 'rate_limit_event') continue

    // Assistant message — text and tool_use blocks
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        // Stream text — send whole block, frontend splits lines
        if (block.type === 'text' && block.text) {
          send({ type: 'text', text: block.text })
        }
        // Tool call — show label + start live streaming bash in parallel
        if (block.type === 'tool_use' && !seenToolIds.has(block.id)) {
          seenToolIds.add(block.id)
          const inp = block.input || {}
          const first = Object.entries(inp)[0]
          const preview = first ? `${first[0]}: "${String(first[1]).slice(0,35)}"` : ''
          send({ type: 'text', text: `→ ${block.name}(${preview})` })

          // For Bash: spawn live stream immediately
          // Claude Code also runs it (for AI context) — parallel is fine
          if (block.name === 'Bash' && inp.command) {
            streamBashLive(inp.command, sd, send)
          }
        }
      }
    }

    // Tool result from Claude Code's internal execution
    // Output already shown via our live stream — suppress duplicate display
    if (ev.type === 'user' && ev.tool_use_result) {
      // Don't re-display stdout, it already streamed live
      // stderr only if we missed it
      const { stderr } = ev.tool_use_result
      if (stderr?.trim()) {
        stderr.split('\n').forEach(l => send({ type: 'bash_line', text: `err: ${l}` }))
      }
    }

    // Write/Read/Edit tool results — show these (no live stream for file ops)
    if (ev.type === 'user' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && block.content) {
          const name = active.lastToolName
          // Only show file op results, not bash (already live-streamed)
          if (name && name !== 'Bash') {
            send({ type: 'tool_result', text: String(block.content).slice(0, 200) })
          }
        }
      }
    }

    // Final result — done
    if (ev.type === 'result') {
      send({ type: 'done' })
      active.resolve()
      active = null
      drain()
    }
  }
}

function drain() {
  if (active || !queue.length || !procReady) return
  active = queue.shift()
  const last = active.messages.filter(m => m.role === 'user').pop()
  writeMsg({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: last?.content || '' }] },
  })
}

// ── HTTP server ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Disable Nagle's algorithm — send each packet immediately
  req.socket.setNoDelay(true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mode: 'live-bash-shadow', version: '4.1', ready: procReady }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', c => body += c)
    await new Promise(r => req.on('end', r))
    let parsed; try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }

    const { messages = [], sessionId = 'default' } = parsed
    const sd = await sessionDir(sessionId)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',        // tell nginx/cloudflared: don't buffer
      'X-Content-Type-Options': 'nosniff',
    })
    res.flushHeaders()                   // flush immediately, don't wait for first write

    const send = d => {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(d)}\n\n`)
        // Force flush through any remaining Node.js buffering
        if (res.socket) res.socket.setNoDelay(true)
      }
    }

    if (!procReady) {
      send({ type: 'text', text: '⚠ Claude starting, please wait…' })
      await new Promise((resolve, reject) => {
        const t = setInterval(() => { if (procReady) { clearInterval(t); resolve() } }, 500)
        setTimeout(() => { clearInterval(t); reject() }, 30000)
      }).catch(() => { send({ type: 'text', text: '✗ Claude failed to start' }); send({ type:'done' }); res.end() })
      if (!procReady) return
    }

    await new Promise(resolve => {
      queue.push({ messages, sd, send, resolve })
      drain()
    })

    if (!res.destroyed) res.end()
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Builtix live-bash bridge v4.1 on http://localhost:${PORT}`)
  spawnClaude()
})
