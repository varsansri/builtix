import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001

// ── Persistent Claude Code process ───────────────────────────────────
// One process stays alive. Each request writes a message to its stdin.
// Claude Code streams back events. No API calls from the bridge itself.

const SYSTEM_APPEND = `You are Builtix — a mobile AI terminal running in Termux.

INTENT DETECTION (decide silently):
- QUESTION → answer in plain text, no tools
- TASK → execute immediately using tools

IF TASK → start with:
● [what you are doing]
  ↳ [step]
  ↳ [step]

Use Bash for ALL code execution. Real Termux: python3, node, gcc, git, apt.
write_file first, then Bash to run it. Fix errors automatically.

After task done:
────────────────────────────────
✓ Done — [summary]
────────────────────────────────
Built: [what was created]
How to use: [instructions]
────────────────────────────────

RULES:
- NEVER say "I would" or "you could" — just DO IT
- No markdown (no ** ## backticks)
- Lines under 50 chars for mobile
- Symbols: ● step  ↳ substep  ✓ done  ✗ error`

let claudeProc = null
let procReady = false
let initDone = false
const requestQueue = []
let activeRequest = null
let outputBuf = ''

function spawnClaude() {
  procReady = false
  initDone = false
  outputBuf = ''

  claudeProc = spawn('claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Edit,Read,Write,Glob,Grep,WebSearch,WebFetch',
    '--add-dir', '/root/builtix',
    '--append-system-prompt', SYSTEM_APPEND,
  ], {
    env: { ...process.env },
    cwd: __dirname,   // bridge dir — claude auto-reads CLAUDE.md here
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  claudeProc.stdout.on('data', onClaudeData)

  claudeProc.stderr.on('data', d => {
    const text = d.toString().trim()
    if (text) console.error('[claude stderr]', text)
  })

  claudeProc.on('exit', (code) => {
    console.log(`[bridge] claude exited (${code}), restarting…`)
    procReady = false
    initDone = false
    setTimeout(spawnClaude, 1000)
  })

  claudeProc.on('error', err => {
    console.error('[bridge] spawn error:', err.message)
    setTimeout(spawnClaude, 2000)
  })

  // Send warmup ping — triggers system init event and loads context
  const warmup = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: '.' }] },
  })
  claudeProc.stdin.write(warmup + '\n')
  console.log('[bridge] claude started, warming up…')
}

function onClaudeData(chunk) {
  outputBuf += chunk.toString()
  const lines = outputBuf.split('\n')
  outputBuf = lines.pop()

  for (const line of lines) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }

    // First system init event
    if (!initDone && ev.type === 'system' && ev.subtype === 'init') {
      initDone = true
      console.log('[bridge] session:', ev.session_id)
      continue
    }

    // Warmup result → now ready
    if (!procReady && ev.type === 'result') {
      procReady = true
      console.log('[bridge] ready ✓')
      drain()
      continue
    }

    // Skip rate_limit_event noise
    if (ev.type === 'rate_limit_event') continue

    // Route to active request
    if (!activeRequest) continue
    const { send, resolve } = activeRequest

    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && block.text) {
          block.text.split('\n').forEach(l => send({ type: 'text', text: l }))
        }
        if (block.type === 'tool_use') {
          const first = Object.entries(block.input || {})[0]
          const preview = first ? `${first[0]}: "${String(first[1]).slice(0, 30)}"` : ''
          send({ type: 'text', text: `→ ${block.name}(${preview})` })
        }
      }
    }

    // Tool result — actual stdout/stderr from running the tool
    if (ev.type === 'user' && ev.tool_use_result) {
      const { stdout, stderr } = ev.tool_use_result
      if (stdout?.trim()) stdout.split('\n').forEach(l => send({ type: 'bash_line', text: l }))
      if (stderr?.trim()) stderr.split('\n').forEach(l => send({ type: 'bash_line', text: `stderr: ${l}` }))
    }

    if (ev.type === 'result') {
      send({ type: 'done' })
      resolve()
      activeRequest = null
      drain()
    }
  }
}

function drain() {
  if (activeRequest || !requestQueue.length || !procReady) return
  const next = requestQueue.shift()
  activeRequest = next
  writeMessage(next.messages)
}

function writeMessage(messages) {
  // Send full conversation as a single user turn (last user message)
  // Claude Code maintains its own session context
  const last = messages.filter(m => m.role === 'user').pop()
  const text = last?.content || ''

  const msg = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  })

  claudeProc.stdin.write(msg + '\n')
}

// ── HTTP server ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mode: 'claude-code-pipe', version: '3.0', ready: procReady }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', c => body += c)
    await new Promise(r => req.on('end', r))

    let parsed
    try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }

    const { messages = [] } = parsed

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (data) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    if (!procReady) {
      send({ type: 'text', text: '⚠ Claude Code starting up, please wait…' })
      // Wait up to 30s for process to be ready
      await new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (procReady) { clearInterval(interval); resolve() }
        }, 500)
        setTimeout(() => { clearInterval(interval); reject(new Error('timeout')) }, 30000)
      }).catch(() => {
        send({ type: 'text', text: '✗ Claude Code failed to start' })
        send({ type: 'done' })
        res.end()
      })
      if (!procReady) return
    }

    await new Promise(resolve => {
      requestQueue.push({ messages, send, resolve })
      drain()
    })

    if (!res.destroyed) res.end()
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Builtix bridge v3 (persistent pipe) on http://localhost:${PORT}`)
  spawnClaude()
})
