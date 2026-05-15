const BASE = import.meta.env.VITE_API_URL || '/api'

export async function streamChat({ messages, sessionId, onEvent, onError, signal }) {
  let response
  try {
    response = await fetch(`${BASE}/chat`, {
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
