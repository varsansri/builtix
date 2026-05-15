// Groq Whisper transcription endpoint
// Accepts base64 audio, returns transcript text

import Groq from 'groq-sdk'

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } }

const KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
].filter(Boolean)

let keyIdx = 0

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).end(); return }

  if (!KEYS.length) {
    res.status(500).json({ error: 'No transcription API key set' })
    return
  }

  const { audio, mimeType = 'audio/webm' } = req.body || {}
  if (!audio) { res.status(400).json({ error: 'Missing audio' }); return }

  const buffer = Buffer.from(audio, 'base64')
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  const file = new File([buffer], `audio.${ext}`, { type: mimeType })

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    try {
      const groq = new Groq({ apiKey: KEYS[keyIdx] })
      const result = await groq.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3-turbo',
        response_format: 'text',
      })
      res.status(200).json({ transcript: result })
      return
    } catch (err) {
      if (err?.status === 429 || err?.status === 402) {
        keyIdx = (keyIdx + 1) % KEYS.length
        continue
      }
      res.status(500).json({ error: err.message })
      return
    }
  }

  res.status(429).json({ error: 'All keys rate limited, try again shortly' })
}
