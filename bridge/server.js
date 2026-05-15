import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const PORT = process.env.PORT || 3001
const SESSION_BASE = path.join(process.env.HOME || '/tmp', '.builtix-sessions')

// ── Session dir ─────────────────────────────────────────────────────

async function sessionDir(sessionId) {
  const dir = path.join(SESSION_BASE, sessionId.replace(/[^a-z0-9_-]/gi, '_'))
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function safe(base, p) {
  const r = path.resolve(base, p)
  if (!r.startsWith(base)) throw new Error('Path outside session')
  return r
}

// ── Tools (same as Vercel api/chat.js) ──────────────────────────────

async function read_file(sd, { path: p }) {
  try {
    const c = await fs.readFile(safe(sd, p), 'utf8')
    return c.split('\n').map((l, i) => `${String(i+1).padStart(4)} │ ${l}`).join('\n')
  } catch (e) { return `✗ ${e.message}` }
}

async function write_file(sd, { path: p, content }) {
  const f = safe(sd, p)
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f, content, 'utf8')
  return `✓ Created: ${p} (${content.split('\n').length} lines)`
}

async function edit_file(sd, { path: p, old_string, new_string }) {
  try {
    const c = await fs.readFile(safe(sd, p), 'utf8')
    if (!c.includes(old_string)) return `✗ Text not found in ${p}`
    await fs.writeFile(safe(sd, p), c.replace(old_string, new_string), 'utf8')
    return `✓ Edited: ${p}`
  } catch (e) { return `✗ ${e.message}` }
}

async function list_directory(sd, { path: p = '.' }) {
  try {
    const entries = await fs.readdir(safe(sd, p), { withFileTypes: true })
    if (!entries.length) return '(empty)'
    return entries.map(e => `  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n')
  } catch (e) { return `✗ ${e.message}` }
}

async function create_directory(sd, { path: p }) {
  await fs.mkdir(safe(sd, p), { recursive: true })
  return `✓ Created dir: ${p}`
}

async function delete_file(sd, { path: p }) {
  try { await fs.unlink(safe(sd, p)); return `✓ Deleted: ${p}` }
  catch (e) { return `✗ ${e.message}` }
}

async function bash_tool(sd, { command, timeout = 30000 }, onLine) {
  const BLOCKED = ['rm -rf /', 'mkfs', ':(){:|:&};:', 'shutdown', 'reboot']
  if (BLOCKED.some(b => command.includes(b))) return '✗ Blocked command'

  return new Promise((resolve) => {
    let finished = false
    let allOutput = ''
    let buf = ''

    const child = spawn('bash', ['-c', command], {
      cwd: sd,
      env: { ...process.env, HOME: sd, PWD: sd },
    })

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill('SIGTERM')
      resolve((allOutput || '').trim() + `\n✗ Timed out after ${timeout / 1000}s`)
    }, timeout)

    function flush(data) {
      buf += data.toString()
      const parts = buf.split('\n')
      buf = parts.pop()
      for (const line of parts) {
        allOutput += line + '\n'
        onLine?.(line)
      }
    }

    child.stdout.on('data', flush)
    child.stderr.on('data', flush)

    child.on('close', () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (buf) { allOutput += buf; onLine?.(buf) }
      resolve(allOutput.trim() || '✓ Done (no output)')
    })

    child.on('error', (err) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(`✗ ${err.message}`)
    })
  })
}

// ── Claude Code bridge ───────────────────────────────────────────────

function buildPrompt(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')
}

async function runClaudeCode(sd, messages, send) {
  return new Promise((resolve) => {
    const prompt = buildPrompt(messages)

    const child = spawn('claude', [
      '-p', prompt,
      '--dangerously-skip-permissions',
    ], {
      cwd: sd,
      env: { ...process.env, HOME: process.env.HOME, PWD: sd },
    })

    let buf = ''

    function flush(data) {
      buf += data.toString()
      const parts = buf.split('\n')
      buf = parts.pop()
      for (const line of parts) {
        send({ type: 'text', text: line })
      }
    }

    child.stdout.on('data', flush)
    child.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) send({ type: 'text', text: `⚠ ${text}` })
    })

    child.on('close', (code) => {
      if (buf.trim()) send({ type: 'text', text: buf.trim() })
      resolve(code)
    })

    child.on('error', (err) => {
      send({ type: 'text', text: `✗ Claude Code error: ${err.message}` })
      resolve(1)
    })
  })
}

// ── HTTP Server ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  // CORS — allow builtix.vercel.app and localhost
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mode: 'claude-code-bridge', version: '1.0' }))
    return
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', chunk => body += chunk)
    await new Promise(resolve => req.on('end', resolve))

    let parsed
    try { parsed = JSON.parse(body) }
    catch { res.writeHead(400); res.end('Bad JSON'); return }

    const { messages = [], sessionId = 'default' } = parsed
    const sd = await sessionDir(sessionId)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (data) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await runClaudeCode(sd, messages, send)
    } catch (err) {
      send({ type: 'text', text: `✗ Error: ${err.message}` })
    }

    send({ type: 'done' })
    res.end()
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Builtix bridge running on http://localhost:${PORT}`)
  console.log(`  Health: http://localhost:${PORT}/health`)
  console.log(`  Chat:   http://localhost:${PORT}/api/chat`)
  console.log(``)
  console.log(`  In Builtix app → tap 🔌 LOCAL → enter:`)
  console.log(`  http://localhost:${PORT}`)
})
