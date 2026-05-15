import { getClient, markExhausted, isRateLimitError } from './keyManager.js'
import { TOOL_DEFINITIONS, executeTool, ensureSession } from './tools.js'

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
- No markdown (no **, no ##, no backtick blocks)
- Prefix meanings:
  →  action / tool call
  ✓  success
  ✗  failure
  ⚠  warning
  ⟹  reasoning
  [Step X/Y]  progress
  ────  divider

TOOL USE RULES:
- read_file before editing any file
- list_directory when exploring unknown structure
- bash for: running scripts, installing packages, checking versions, git
- web_search when you need current information
- Always verify results after writing files`

export async function runAgentLoop({ messages, sessionId, onEvent, signal }) {
  const sessionDir = await ensureSession(sessionId)
  const conversation = [...messages]

  let attempts = 0
  const MAX_TOOL_TURNS = 20

  while (attempts < MAX_TOOL_TURNS) {
    if (signal?.aborted) break
    attempts++

    let { client, keyIndex } = getClient()
    let response

    // retry loop for key rotation
    for (let retry = 0; retry < 4; retry++) {
      try {
        response = await client.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: conversation,
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          max_tokens: 4096,
          stream: false,
        })
        break
      } catch (err) {
        if (isRateLimitError(err)) {
          markExhausted(keyIndex)
          const next = getClient()
          client = next.client
          keyIndex = next.keyIndex
          onEvent({ type: 'system', text: `⚠ Key ${retry + 1} limit hit, switching...` })
          continue
        }
        throw err
      }
    }

    const message = response.choices[0].message
    conversation.push(message)

    // stream any text content
    if (message.content) {
      const lines = message.content.split('\n')
      for (const line of lines) {
        onEvent({ type: 'text', text: line })
      }
    }

    // no tool calls — we're done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      onEvent({ type: 'done' })
      return
    }

    // execute each tool call
    const toolResults = []
    for (const tc of message.tool_calls) {
      if (signal?.aborted) break
      const name = tc.function.name
      let args
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        args = {}
      }

      onEvent({ type: 'tool_call', name, args })

      const result = await executeTool(sessionDir, name, args)

      onEvent({ type: 'tool_result', name, result })

      toolResults.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }

    conversation.push(...toolResults)
  }

  onEvent({ type: 'error', text: '⚠ Max steps reached. Task may be incomplete.' })
}
