import Groq from 'groq-sdk'
import fs from 'fs/promises'
import path from 'path'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import fetch from 'node-fetch'

const execAsync = promisify(exec)

// ── Key rotation ────────────────────────────────────────────────────

const KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
].filter(Boolean)

let keyIndex = 0

function getClient() {
  return new Groq({ apiKey: KEYS[keyIndex] })
}

function nextKey(label) {
  keyIndex = (keyIndex + 1) % KEYS.length
  return `⚠ Key limit hit (${label}), switching to key ${keyIndex + 1}...`
}

function isRateLimit(err) {
  return err?.status === 429 || err?.status === 402 ||
    String(err?.message).includes('rate_limit') ||
    String(err?.message).includes('quota')
}

// ── Session filesystem ──────────────────────────────────────────────

const SESSION_BASE = '/tmp/builtix-sessions'

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

// ── Tools ───────────────────────────────────────────────────────────

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

async function bash(sd, { command, timeout = 20000 }, onLine) {
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

async function web_search(_, { query }) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    const html = await res.text()
    const results = []
    const re = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    let m
    while ((m = re.exec(html)) && results.length < 5)
      results.push(`• ${m[2].trim()}\n  ${m[1]}`)
    return results.join('\n\n') || 'No results.'
  } catch (e) { return `✗ ${e.message}` }
}

async function web_fetch(_, { url }) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    return text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n').trim().slice(0, 3000)
  } catch (e) { return `✗ ${e.message}` }
}

const TOOLS = {
  read_file, write_file, edit_file, list_directory,
  create_directory, delete_file, bash, web_search, web_fetch
}

const TOOL_DEFS = [
  { type:'function', function:{ name:'read_file', description:'Read file contents with line numbers.', parameters:{ type:'object', properties:{ path:{type:'string'} }, required:['path'] } } },
  { type:'function', function:{ name:'write_file', description:'Create or overwrite a file.', parameters:{ type:'object', properties:{ path:{type:'string'}, content:{type:'string'} }, required:['path','content'] } } },
  { type:'function', function:{ name:'edit_file', description:'Replace exact text in a file. Read file first.', parameters:{ type:'object', properties:{ path:{type:'string'}, old_string:{type:'string'}, new_string:{type:'string'} }, required:['path','old_string','new_string'] } } },
  { type:'function', function:{ name:'list_directory', description:'List files in a directory.', parameters:{ type:'object', properties:{ path:{type:'string'} }, required:[] } } },
  { type:'function', function:{ name:'create_directory', description:'Create a directory.', parameters:{ type:'object', properties:{ path:{type:'string'} }, required:['path'] } } },
  { type:'function', function:{ name:'delete_file', description:'Delete a file.', parameters:{ type:'object', properties:{ path:{type:'string'} }, required:['path'] } } },
  { type:'function', function:{ name:'bash', description:'Run a shell command. Use for running scripts, installing packages, git, testing code.', parameters:{ type:'object', properties:{ command:{type:'string'}, timeout:{type:'number'} }, required:['command'] } } },
  { type:'function', function:{ name:'web_search', description:'Search the web.', parameters:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } } },
  { type:'function', function:{ name:'web_fetch', description:'Fetch URL content.', parameters:{ type:'object', properties:{ url:{type:'string'} }, required:['url'] } } },
]

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

FOLLOW-UP DETECTION (check conversation history):
- Change request → modify the files, re-run, show new output
- Question about what was built → explain it clearly
- New unrelated task → start fresh

STRICT RULES — never break:
- NEVER fake output — use bash to actually compile/run/test
- NEVER say "I would" or "you could" — just DO IT
- NEVER use markdown (no ** ## or backticks in responses)
- Lines under 50 chars for mobile
- Symbols: ● step  ↳ substep  ✓ done  ✗ error  ⚠ warn`


// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { messages, sessionId = 'default' } = req.body
  const sd = await sessionDir(sessionId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const send = (data) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const conversation = [{ role: 'system', content: SYSTEM }, ...messages]

  try {
    for (let turn = 0; turn < 20; turn++) {
      let response

      for (let attempt = 0; attempt < KEYS.length; attempt++) {
        try {
          response = await getClient().chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: conversation,
            tools: TOOL_DEFS,
            tool_choice: 'auto',
            max_tokens: 4096,
          })
          break
        } catch (err) {
          if (isRateLimit(err) && attempt < KEYS.length - 1) {
            send({ type: 'text', text: nextKey(KEYS[keyIndex]) })
            continue
          }
          throw err
        }
      }

      const msg = response.choices[0].message
      conversation.push(msg)

      if (msg.content) {
        msg.content.split('\n').forEach(line => send({ type: 'text', text: line }))
      }

      if (!msg.tool_calls?.length) {
        send({ type: 'done' })
        res.end()
        return
      }

      const results = []
      for (const tc of msg.tool_calls) {
        const name = tc.function.name
        let args
        try { args = JSON.parse(tc.function.arguments) } catch { args = {} }

        const short = Object.entries(args)[0]
        const preview = short ? `${short[0]}: "${String(short[1]).slice(0, 35)}"` : ''
        send({ type: 'text', text: `→ ${name}(${preview})` })

        let result
        if (name === 'bash') {
          // Stream each output line live as it prints
          result = await TOOLS.bash(sd, args, (line) => send({ type: 'bash_line', text: line }))
        } else {
          result = await (TOOLS[name]?.(sd, args) ?? `✗ Unknown tool: ${name}`)
          send({ type: 'tool_result', text: result })
        }

        results.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }

      conversation.push(...results)
    }

    send({ type: 'text', text: '⚠ Max steps reached.' })
    send({ type: 'done' })
  } catch (err) {
    send({ type: 'text', text: `✗ Error: ${err.message}` })
    send({ type: 'done' })
  }

  res.end()
}
