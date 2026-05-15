import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { runAgentLoop } from './services/executor.js'

config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const SYSTEM_PROMPT = `You are Builtix — a powerful AI terminal assistant with full tool access.
You work exactly like Claude Code: you read files, write files, run commands, search the web, and build real things step by step.

BEHAVIOR:
- Always think step by step before acting
- Use tools proactively — read files before editing, list dirs before creating
- Show your plan first: [Step X/Y] What you are doing
- Announce every tool call with → before calling it
- After each tool result, explain what it means
- End with ✓ Done — summary of what was built/changed

OUTPUT FORMAT (monospace terminal, mobile screen):
- Max ~50 chars per line
- No markdown
- Prefix meanings:
  →  action / tool call
  ✓  success
  ✗  failure
  ⚠  warning
  ⟹  reasoning
  [Step X/Y]  progress
  ────  divider`

app.post('/api/chat', async (req, res) => {
  const { messages, sessionId = 'default' } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (data) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const controller = new AbortController()
  req.on('close', () => controller.abort())

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ]

  try {
    await runAgentLoop({
      messages: fullMessages,
      sessionId,
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case 'text':
            send({ type: 'text', text: event.text })
            break
          case 'tool_call':
            send({
              type: 'tool_call',
              text: `→ ${event.name}(${formatArgs(event.args)})`,
            })
            break
          case 'tool_result':
            send({ type: 'tool_result', text: event.result })
            break
          case 'system':
            send({ type: 'text', text: event.text })
            break
          case 'error':
            send({ type: 'error', text: event.text })
            break
          case 'done':
            send({ type: 'done' })
            break
        }
      },
    })
  } catch (err) {
    send({ type: 'error', text: `✗ ${err.message}` })
    send({ type: 'done' })
  }

  res.end()
})

function formatArgs(args) {
  const entries = Object.entries(args)
  if (!entries.length) return ''
  const [key, val] = entries[0]
  const str = String(val).slice(0, 40)
  return entries.length === 1 ? `${key}: "${str}"` : `${key}: "${str}", +${entries.length - 1}`
}

app.get('/api/health', (_, res) => res.json({ status: 'ok', name: 'Builtix' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`✓ Builtix backend on port ${PORT}`))
