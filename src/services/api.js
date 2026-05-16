let _bridgeUrl = ''

export function isBridgeActive() { return !!_bridgeUrl }
export function getBridgeUrl() { return _bridgeUrl }

// Detect bridge on load and every 10s.
// Priority: localhost → cloudflared tunnel → Vercel fallback
export async function detectBridge() {
  // 1. Try localhost (developer's own phone)
  try {
    const r = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) })
    if (r.ok && (await r.json()).ok) { _bridgeUrl = 'http://localhost:3001'; return true }
  } catch {}

  // 2. Ask Vercel registry for a shared tunnel URL
  try {
    const r = await fetch('/api/bridge-url', { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const { url, online } = await r.json()
      if (online && url) {
        const h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
        if (h.ok && (await h.json()).ok) { _bridgeUrl = url; return true }
      }
    }
  } catch {}

  _bridgeUrl = ''
  return false  // will fall back to Vercel API
}

// Stream a chat request.
// When bridge is live → use it (Claude Code on developer's phone).
// When bridge is offline → silently fall back to Vercel/Groq (same SSE format).
export async function streamChat({ messages, sessionId, onEvent, onError, signal }) {
  const url = _bridgeUrl
    ? `${_bridgeUrl}/api/chat`
    : '/api/chat'

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, sessionId }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') { onError('⚠ Stopped.'); return }
    // Bridge unreachable — retry with Vercel
    if (_bridgeUrl) {
      try {
        response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, sessionId }),
          signal,
        })
      } catch (e2) {
        onError(`✗ Connection error: ${e2.message}`)
        return
      }
    } else {
      onError(`✗ Connection error: ${err.message}`)
      return
    }
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
