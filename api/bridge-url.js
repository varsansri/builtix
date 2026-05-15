// Bridge URL registry — persisted in Upstash Redis via REST API
// Survives serverless cold starts, shared across all Vercel instances

const TOKEN = process.env.BRIDGE_TOKEN || 'builtrix-bridge'
const REDIS_URL = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN

async function redisCmd(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const { result } = await r.json()
  return result
}

export default async function handler(req, res) {
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

    // Store URL + timestamp, expire after 2 hours
    await redisCmd('SET', 'bridge_url', url)
    await redisCmd('SET', 'bridge_ts', String(Date.now()), 'EX', 7200)

    console.log('[registry] bridge registered:', url)
    res.status(200).json({ ok: true, url })
    return
  }

  // Website fetches the current bridge URL
  if (req.method === 'GET') {
    const url = await redisCmd('GET', 'bridge_url')
    const ts = await redisCmd('GET', 'bridge_ts')
    const age = ts ? Date.now() - Number(ts) : Infinity
    const online = !!url && age < 2 * 60 * 60 * 1000

    res.status(200).json({ url: online ? url : '', online, age: Math.floor(age / 1000) })
    return
  }

  res.status(405).end()
}
