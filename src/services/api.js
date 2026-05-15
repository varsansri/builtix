let _bridgeUrl = ''   // set once registry responds

export function isBridgeActive() { return !!_bridgeUrl }
export function getBridgeUrl() { return _bridgeUrl }

// On load: ask Vercel registry for the current bridge URL,
// then health-check it. Also checks localhost for local dev.
export async function detectBridge() {
  // 1. Try localhost (running on the same phone)
  try {
    const r = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) })
    if (r.ok && (await r.json()).ok) {
      _bridgeUrl = 'http://localhost:3001'
      return true
    }
  } catch {}

  // 2. Ask Vercel registry for the public tunnel URL
  try {
    const r = await fetch('/api/bridge-url', { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const { url, online } = await r.json()
      if (online && url) {
        // Health-check the tunnel
        const h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
        if (h.ok && (await h.json()).ok) {
          _bridgeUrl = url
          return true
        }
      }
    }
  } catch {}

  _bridgeUrl = ''
  return false
}

export async function streamChat({ messages, sessionId, onEvent, onError, signal }) {
  if (!_bridgeUrl) {
    onError('✗ Bridge offline. Run bridge/start.sh in Termux.')
    return
  }

  let response
  try {
    response = await fetch(`${_bridgeUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, sessionId }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') { onError('⚠ Stopped.'); return }
    onError(`✗ Connection error: ${err.message}`)
    return
  }

  if (!response.ok) { onError(`✗ Bridge error: ${response.status}`); return }

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
