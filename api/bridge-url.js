// In-memory registry — bridge POSTs its public URL here on startup
// Everyone who opens the site GETs this URL and connects directly

let currentUrl = ''
let registeredAt = 0

const TOKEN = process.env.BRIDGE_TOKEN || 'builtix-bridge'

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-bridge-token')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  // Bridge registers its public URL
  if (req.method === 'POST') {
    const token = req.headers['x-bridge-token']
    if (token !== TOKEN) { res.status(401).json({ error: 'bad token' }); return }
    const { url } = req.body || {}
    if (!url) { res.status(400).json({ error: 'missing url' }); return }
    currentUrl = url
    registeredAt = Date.now()
    console.log('[registry] bridge registered:', url)
    res.status(200).json({ ok: true, url })
    return
  }

  // Website fetches the current bridge URL
  if (req.method === 'GET') {
    const age = Date.now() - registeredAt
    const online = !!currentUrl && age < 60 * 60 * 1000  // stale after 1h
    res.status(200).json({ url: online ? currentUrl : '', online, age: Math.floor(age / 1000) })
    return
  }

  res.status(405).end()
}
