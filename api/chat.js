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

const SESSION_BASE = '/tmp/builtrix-sessions'

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

const PISTON_LANGS = {
  python: { id: 'python',     ext: 'main.py'   },
  py:     { id: 'python',     ext: 'main.py'   },
  cpp:    { id: 'c++',        ext: 'main.cpp'  },
  'c++':  { id: 'c++',        ext: 'main.cpp'  },
  c:      { id: 'c',          ext: 'main.c'    },
  java:   { id: 'java',       ext: 'Main.java' },
  go:     { id: 'go',         ext: 'main.go'   },
  rust:   { id: 'rust',       ext: 'main.rs'   },
  ruby:   { id: 'ruby',       ext: 'main.rb'   },
  php:    { id: 'php',        ext: 'main.php'  },
  swift:  { id: 'swift',      ext: 'main.swift'},
  kotlin: { id: 'kotlin',     ext: 'main.kt'   },
  ts:     { id: 'typescript', ext: 'main.ts'   },
  typescript: { id: 'typescript', ext: 'main.ts'},
  js:     { id: 'javascript', ext: 'main.js'   },
  javascript: { id: 'javascript', ext: 'main.js'},
  node:   { id: 'javascript', ext: 'main.js'   },
  bash:   { id: 'bash',       ext: 'main.sh'   },
  sh:     { id: 'bash',       ext: 'main.sh'   },
}

async function execute_code(_, { language, code, stdin = '' }) {
  const key = (language || '').toLowerCase().replace(/\s/g, '')
  const lang = PISTON_LANGS[key]
  if (!lang) return `✗ Unsupported language: ${language}`

  try {
    const res = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: lang.id,
        version: '*',
        files: [{ name: lang.ext, content: code }],
        stdin,
        run_timeout: 10000,
        compile_timeout: 15000,
      }),
      signal: AbortSignal.timeout(35000),
    })

    if (!res.ok) return `✗ Piston error: ${res.status}`
    const d = await res.json()

    const out = []
    if (d.compile?.output?.trim()) out.push(`── compile ──\n${d.compile.output.trim()}`)
    if (d.run?.stdout?.trim())     out.push(d.run.stdout.trim())
    if (d.run?.stderr?.trim())     out.push(`── stderr ──\n${d.run.stderr.trim()}`)
    if (d.run?.code !== 0)         out.push(`✗ Exit code: ${d.run.code}`)
    else if (!out.length)          out.push('✓ Program ran with no output')

    return out.join('\n')
  } catch (e) {
    return `✗ ${e.message}`
  }
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
  create_directory, delete_file, bash, web_search, web_fetch, execute_code
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
  { type:'function', function:{ name:'execute_code', description:'Compile and run code in any language via Piston cloud executor. Use for Python, C++, Java, Go, Rust, Ruby, PHP, Swift, Kotlin, TypeScript. Returns real compiler output + stdout + stderr. For interactive programs pass sample stdin values. AI picks the best language for the task.', parameters:{ type:'object', properties:{ language:{type:'string', description:'python, cpp, c, java, go, rust, ruby, php, swift, kotlin, typescript, javascript, bash'}, code:{type:'string', description:'Complete source code'}, stdin:{type:'string', description:'Sample input for interactive programs, newline-separated'} }, required:['language','code'] } } },
]

const SYSTEM = `You are Builtrix — a powerful AI terminal that EXECUTES real tasks.

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

CODE EXECUTION:
- Use execute_code for ALL runnable programs
- Pick the BEST language for the task:
  calculator/script → python
  performance/systems → cpp or go
  web/api → javascript
  data/ml → python
  user said a specific language → use that
- write_file first so user can see the code
- then execute_code to compile and run it
- For interactive programs: look at what inputs
  the code needs, put sample values in stdin
  so the output shows real results
- If it fails: read the error, fix the code,
  execute again automatically — never give up

STRICT RULES — never break:
- NEVER fake output — use execute_code for real results
- NEVER say "I would" or "you could" — just DO IT
- NEVER use markdown (no ** ## or backticks)
- Lines under 50 chars for mobile
- Symbols: ● step  ↳ substep  ✓ done  ✗ error  ⚠ warn`


// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

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
          result = await TOOLS.bash(sd, args, (line) => send({ type: 'bash_line', text: line }))
        } else if (name === 'execute_code') {
          result = await TOOLS.execute_code(sd, args)
          result.split('\n').forEach(line => send({ type: 'bash_line', text: line }))
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
