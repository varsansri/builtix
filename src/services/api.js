const VERCEL_BASE = import.meta.env.VITE_API_URL || '/api'
const LOCAL_URL = 'http://localhost:3001'

let _bridgeActive = false

export function isBridgeActive() { return _bridgeActive }

export async function detectBridge() {
  try {
    const res = await fetch(`${LOCAL_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) { _bridgeActive = false; return false }
    const d = await res.json()
    _bridgeActive = d.ok === true
    return _bridgeActive
  } catch {
    _bridgeActive = false
    return false
  }
}

function getBase() {
  return _bridgeActive ? LOCAL_URL : VERCEL_BASE
}

export async function streamChat({ messages, sessionId, onEvent, onError, signal }) {
  let response
  try {
    response = await fetch(`${getBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, sessionId }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') { onError('⚠ Process stopped by user.'); return }
    onError(`✗ Connection error: ${err.message}`)
    return
  }

  if (!response.ok) { onError(`✗ Server error: ${response.status}`); return }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        onEvent(data)
        if (data.type === 'done' || data.type === 'error') return
      } catch {}
    }
  }
}
