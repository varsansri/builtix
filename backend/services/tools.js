import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import fetch from 'node-fetch'

const execAsync = promisify(exec)
const SESSION_BASE = process.env.SESSION_DIR || '/tmp/builtix-sessions'

async function ensureSession(sessionId) {
  const dir = path.join(SESSION_BASE, sessionId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function safePath(sessionDir, filePath) {
  const resolved = path.resolve(sessionDir, filePath)
  if (!resolved.startsWith(sessionDir)) throw new Error('Path outside session directory')
  return resolved
}

// ── Tool Implementations ────────────────────────────────────────────

async function readFile(sessionDir, { path: filePath }) {
  const full = safePath(sessionDir, filePath)
  try {
    const content = await fs.readFile(full, 'utf8')
    const lines = content.split('\n')
    const numbered = lines.map((l, i) => `${String(i + 1).padStart(4)} │ ${l}`).join('\n')
    return `File: ${filePath} (${lines.length} lines)\n\n${numbered}`
  } catch (e) {
    return `✗ Cannot read ${filePath}: ${e.message}`
  }
}

async function writeFile(sessionDir, { path: filePath, content }) {
  const full = safePath(sessionDir, filePath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
  const lines = content.split('\n').length
  return `✓ Created: ${filePath} (${lines} lines)`
}

async function editFile(sessionDir, { path: filePath, old_string, new_string }) {
  const full = safePath(sessionDir, filePath)
  let content
  try {
    content = await fs.readFile(full, 'utf8')
  } catch {
    return `✗ File not found: ${filePath}`
  }
  if (!content.includes(old_string)) {
    return `✗ String not found in ${filePath}. Check exact text including whitespace.`
  }
  const updated = content.replace(old_string, new_string)
  await fs.writeFile(full, updated, 'utf8')
  return `✓ Edited: ${filePath}`
}

async function listDirectory(sessionDir, { path: dirPath = '.' }) {
  const full = safePath(sessionDir, dirPath)
  try {
    const entries = await fs.readdir(full, { withFileTypes: true })
    if (entries.length === 0) return `(empty directory)`
    const lines = entries.map(e => {
      const prefix = e.isDirectory() ? '📁' : '📄'
      return `  ${prefix} ${e.name}`
    })
    return `Directory: ${dirPath}\n${lines.join('\n')}`
  } catch (e) {
    return `✗ Cannot list ${dirPath}: ${e.message}`
  }
}

async function createDirectory(sessionDir, { path: dirPath }) {
  const full = safePath(sessionDir, dirPath)
  await fs.mkdir(full, { recursive: true })
  return `✓ Created directory: ${dirPath}`
}

async function deleteFile(sessionDir, { path: filePath }) {
  const full = safePath(sessionDir, filePath)
  try {
    await fs.unlink(full)
    return `✓ Deleted: ${filePath}`
  } catch (e) {
    return `✗ Cannot delete ${filePath}: ${e.message}`
  }
}

async function bash(sessionDir, { command, timeout = 15000 }) {
  const BLOCKED = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'shutdown', 'reboot', 'curl | sh', 'wget | sh']
  if (BLOCKED.some(b => command.includes(b))) {
    return `✗ Blocked: dangerous command detected`
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: sessionDir,
      timeout,
      maxBuffer: 1024 * 512,
      env: { ...process.env, HOME: sessionDir, PWD: sessionDir },
    })
    const out = [stdout, stderr].filter(Boolean).join('\n').trim()
    return out || '✓ Command completed (no output)'
  } catch (e) {
    if (e.killed) return `✗ Timed out after ${timeout / 1000}s`
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
    return out || `✗ ${e.message}`
  }
}

async function webSearch(_, { query }) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    })
    const html = await res.text()
    const results = []
    const re = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    const snippetRe = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g
    let m, s
    while ((m = re.exec(html)) && results.length < 6) {
      s = snippetRe.exec(html)
      results.push(`• ${m[2].trim()}\n  ${s ? s[1].trim() : ''}\n  ${m[1]}`)
    }
    return results.length ? results.join('\n\n') : 'No results found.'
  } catch (e) {
    return `✗ Search failed: ${e.message}`
  }
}

async function webFetch(_, { url }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    const text = await res.text()
    const clean = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .trim()
      .slice(0, 4000)
    return clean || '(empty page)'
  } catch (e) {
    return `✗ Fetch failed: ${e.message}`
  }
}

// ── Tool Definitions for Groq ───────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Shows line numbers.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to session directory' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing an exact string. Use read_file first to get exact content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'Exact text to find and replace' },
          new_string: { type: 'string', description: 'New text to replace it with' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path (default: .)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a new directory (including parents).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path to create' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File to delete' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command. Working directory is the session folder. Use for: running code, installing packages, git, compiling, checking output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 15000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch and read the content of a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to fetch' } },
        required: ['url'],
      },
    },
  },
]

// ── Tool Router ─────────────────────────────────────────────────────

export async function executeTool(sessionDir, name, args) {
  const map = {
    read_file: readFile,
    write_file: writeFile,
    edit_file: editFile,
    list_directory: listDirectory,
    create_directory: createDirectory,
    delete_file: deleteFile,
    bash,
    web_search: webSearch,
    web_fetch: webFetch,
  }
  const fn = map[name]
  if (!fn) return `✗ Unknown tool: ${name}`
  return await fn(sessionDir, args)
}

export { ensureSession }
