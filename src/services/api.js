const VERCEL_BASE = import.meta.env.VITE_API_URL || '/api'

function getBase() {
  try {
    const local = localStorage.getItem('builtix_bridge_url')
    if (local) return local.replace(/\/$/, '') + '/api'
  } catch {}
  return VERCEL_BASE
}

export async function streamChat({ messages, sessionId, onEvent, onError, signal }) {
  let response
  try {
    response = await fetch(`${getBase()}/chat`, {
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

export async function checkBridge(url) {
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/health', {
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return false
    const d = await res.json()
    return d.ok === true
  } catch {
    return false
  }
}

export function getBridgeUrl() {
  try { return localStorage.getItem('builtix_bridge_url') || '' } catch { return '' }
}

export function setBridgeUrl(url) {
  try {
    if (url) localStorage.setItem('builtix_bridge_url', url)
    else localStorage.removeItem('builtix_bridge_url')
  } catch {}
}
