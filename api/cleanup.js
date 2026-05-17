import { del } from '@vercel/blob'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).end(); return }

  const { urls } = req.body || {}
  if (!urls?.length) { res.status(200).json({ ok: true, deleted: 0 }); return }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(200).json({ ok: true, note: 'Blob not configured' })
    return
  }

  try {
    // del() accepts a single URL or array
    await del(urls)
    console.log(`[cleanup] deleted ${urls.length} file(s)`)
    res.status(200).json({ ok: true, deleted: urls.length })
  } catch (err) {
    console.error('[cleanup]', err.message)
    // Don't error — cleanup failures are non-critical
    res.status(200).json({ ok: true, note: err.message })
  }
}
