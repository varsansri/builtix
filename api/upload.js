import { put } from '@vercel/blob'

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } }

const ALLOWED_TYPES = [
  'image/', 'video/', 'audio/',
  'application/pdf',
  'text/',
  'application/json',
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).end(); return }

  const { name, type = 'application/octet-stream', data } = req.body || {}
  if (!name || !data) { res.status(400).json({ error: 'missing name or data' }); return }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: 'Blob storage not configured. Add BLOB_READ_WRITE_TOKEN in Vercel.' })
    return
  }

  try {
    const buffer = Buffer.from(data, 'base64')
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `uploads/${Date.now()}-${safeName}`

    const blob = await put(path, buffer, {
      access: 'public',
      contentType: type,
    })

    res.status(200).json({
      ok: true,
      url: blob.url,
      name,
      type,
      size: buffer.length,
    })
  } catch (err) {
    console.error('[upload]', err.message)
    res.status(500).json({ error: err.message })
  }
}
