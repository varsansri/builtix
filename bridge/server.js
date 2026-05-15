import http from 'http'
import https from 'https'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'

const PORT = process.env.PORT || 3001
const SESSION_BASE = path.join(process.env.HOME || '/tmp', '.builtix-sessions')
const CREDS_PATH = path.join(process.env.HOME || '/root', '.claude', '.credentials.json')

// ── Credentials ──────────────────────────────────────────────────────

async function getToken() {
  try {
    const raw = await fs.readFile(CREDS_PATH, 'utf8')
    const creds = JSON.parse(raw)
    const token = creds?.claudeAiOauth?.accessToken
    if (!token) throw new Error('No access token found')
    return token
  } catch (e) {
    throw new Error(`Cannot read credentials: ${e.message}`)
  }
}

// ── Direct Anthropic API call with streaming ─────────────────────────

const SYSTEM = `You are Builtix — a mobile AI terminal that EXECUTES real tasks like Claude Code.

INTENT DETECTION (decide this silently for every message):
- QUESTION: what/why/how/explain/compare → answer in plain text, NO tools
- TASK: create/build/write/run/fix/install/make/generate → execute for real using tools

IF QUESTION → answer directly. Short lines. No markdown. Done.

IF TASK → start IMMEDIATELY with this exact format:
● [what you are doing right now]
  ↳ [step 1]
  ↳ [step 2]
  ↳ [step 3]

Then use tools to execute each step. Announce each step before calling the tool:
● Writing [filename]...
● Compiling...
● Running...
● Installing...

If a step FAILS → fix it automatically, keep going, show the fix.
Never ask permission to continue — just do it.

AFTER EVERY COMPLETED TASK — always end with:
────────────────────────────────
✓ Done — [one line summary]
────────────────────────────────
Built: [what was created]
How to use: [clear instructions]
────────────────────────────────

CODE EXECUTION:
- Use bash tool for ALL runnable programs (python, node, gcc are available in Termux)
- Pick the BEST language for the task
- write_file first so user can see the code
- then bash to compile and run it
- If it fails: read the error, fix the code, run again — never give up

STRICT RULES — never break:
- NEVER fake output — use bash for real results
- NEVER say "I would" or "you could" — just DO IT
- NEVER use markdown (no ** ## or backticks)
- Lines under 50 chars for mobile
- Symbols: ● step  ↳ substep  ✓ done  ✗ error  ⚠ warn`

const TOOL_DEFS = [
  { name: 'read_file', description: 'Read file contents with line numbers.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or overwrite a file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace exact text in a file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } },
  { name: 'list_directory', description: 'List files in a directory.', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'bash', description: 'Run shell commands. python3, node, gcc, git, apt all available.', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
  { name: 'web_search', description: 'Search the web.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
]

async function callAnthropic(token, messages) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM,
    tools: TOOL_DEFS,
    tool_choice: { type: 'auto' },
    messages,
    stream: true,
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, resolve)
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Session filesystem ───────────────────────────────────────────────

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

// ── Tools ────────────────────────────────────────────────────────────

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

async function bash_tool(sd, { command, timeout = 30000 }, onLine) {
  const BLOCKED = ['rm -rf /', 'mkfs', ':(){:|:&};:', 'shutdown', 'reboot']
  if (BLOCKED.some(b => command.includes(b))) return '✗ Blocked command'

  return new Promise((resolve) => {
    let finished = false
    let allOutput = ''
    let buf = ''

    const child = spawn('bash', ['-c', command], {
      cwd: sd,
      env: { ...process.env, HOME: process.env.HOME, PWD: sd },
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

async function web_search(_, { query }) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const html = await httpsGet(url, { 'User-Agent': 'Mozilla/5.0' })
    const results = []
    const re = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    let m
    while ((m = re.exec(html)) && results.length < 5)
      results.push(`• ${m[2].trim()}\n  ${m[1]}`)
    return results.join('\n\n') || 'No results.'
  } catch (e) { return `✗ ${e.message}` }
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

const TOOLS = { read_file, write_file, edit_file, list_directory, bash: bash_tool, web_search }

// ── SSE streaming agentic loop ───────────────────────────────────────

async function runAgentLoop(messages, sd, send) {
  const token = await getToken()
  const conversation = [...messages]

  for (let turn = 0; turn < 20; turn++) {
    const apiRes = await callAnthropic(token, conversation)

    if (apiRes.statusCode !== 200) {
      let errBody = ''
      await new Promise(r => { apiRes.on('data', d => errBody += d); apiRes.on('end', r) })
      throw new Error(`API ${apiRes.statusCode}: ${errBody.slice(0, 200)}`)
    }

    // Parse SSE stream from Anthropic
    let buf = ''
    let textBuf = ''
    let toolCalls = []
    let currentTool = null
    let inputBuf = ''
    let stopReason = null

    await new Promise((resolve, reject) => {
      apiRes.on('data', chunk => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') { resolve(); return }
          let ev
          try { ev = JSON.parse(raw) } catch { continue }

          if (ev.type === 'content_block_start') {
            if (ev.content_block?.type === 'tool_use') {
              currentTool = { id: ev.content_block.id, name: ev.content_block.name }
              inputBuf = ''
            }
          } else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta') {
              const text = ev.delta.text || ''
              textBuf += text
              // stream each complete line
              const parts = textBuf.split('\n')
              textBuf = parts.pop()
              for (const part of parts) send({ type: 'text', text: part })
            } else if (ev.delta?.type === 'input_json_delta') {
              inputBuf += ev.delta.partial_json || ''
            }
          } else if (ev.type === 'content_block_stop') {
            if (currentTool) {
              let args = {}
              try { args = JSON.parse(inputBuf) } catch {}
              toolCalls.push({ ...currentTool, args })
              currentTool = null
              inputBuf = ''
            }
          } else if (ev.type === 'message_delta') {
            stopReason = ev.delta?.stop_reason
          } else if (ev.type === 'message_stop') {
            resolve()
          }
        }
      })
      apiRes.on('end', resolve)
      apiRes.on('error', reject)
    })

    // flush remaining text
    if (textBuf.trim()) send({ type: 'text', text: textBuf })

    // Build assistant message for conversation
    const assistantContent = []
    if (textBuf || toolCalls.length === 0) {
      // text was streamed, add placeholder
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
    }

    if (toolCalls.length === 0) {
      // No tool calls — we're done
      return
    }

    // Reconstruct assistant message properly
    conversation.push({
      role: 'assistant',
      content: assistantContent,
    })

    // Execute tools
    const toolResults = []
    for (const tc of toolCalls) {
      const { id, name, args } = tc
      const preview = Object.entries(args)[0]
      send({ type: 'text', text: `→ ${name}(${preview ? `${preview[0]}: "${String(preview[1]).slice(0, 30)}"` : ''})` })

      let result
      if (name === 'bash') {
        result = await TOOLS.bash(sd, args, line => send({ type: 'bash_line', text: line }))
      } else {
        result = await (TOOLS[name]?.(sd, args) ?? `✗ Unknown tool: ${name}`)
        send({ type: 'tool_result', text: result })
      }

      toolResults.push({ type: 'tool_result', tool_use_id: id, content: result })
    }

    conversation.push({ role: 'user', content: toolResults })
  }

  send({ type: 'text', text: '⚠ Max steps reached.' })
}

// ── HTTP Server ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mode: 'direct-api', version: '2.0' }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', chunk => body += chunk)
    await new Promise(resolve => req.on('end', resolve))

    let parsed
    try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end('Bad JSON'); return }

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
      await runAgentLoop(messages, sd, send)
    } catch (err) {
      send({ type: 'text', text: `✗ Error: ${err.message}` })
    }

    send({ type: 'done' })
    res.end()
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Builtix bridge v2 (direct API) on http://localhost:${PORT}`)
})
