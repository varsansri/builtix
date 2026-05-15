import Groq from 'groq-sdk'

const KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
].filter(Boolean)

let currentIndex = 0
const exhausted = new Set()

function getClient() {
  for (let i = 0; i < KEYS.length; i++) {
    const idx = (currentIndex + i) % KEYS.length
    if (!exhausted.has(idx)) {
      currentIndex = idx
      return { client: new Groq({ apiKey: KEYS[idx] }), keyIndex: idx }
    }
  }
  // all exhausted — reset and try again
  console.warn('[KeyManager] All keys exhausted, resetting...')
  exhausted.clear()
  currentIndex = 0
  return { client: new Groq({ apiKey: KEYS[0] }), keyIndex: 0 }
}

function markExhausted(keyIndex) {
  exhausted.add(keyIndex)
  console.warn(`[KeyManager] Key ${keyIndex + 1} exhausted, switching...`)
  currentIndex = (keyIndex + 1) % KEYS.length
}

function isRateLimitError(err) {
  return (
    err?.status === 429 ||
    err?.status === 402 ||
    err?.message?.includes('rate_limit') ||
    err?.message?.includes('quota') ||
    err?.message?.includes('credits') ||
    err?.error?.type === 'tokens' ||
    err?.error?.code === 'rate_limit_exceeded'
  )
}

export { getClient, markExhausted, isRateLimitError, KEYS }
