// MediaRecorder-based recording — up to 10 min, transcribed via Groq Whisper
// Records in 3-min segments to stay within server body limits

let stream = null
let mediaRecorder = null
let chunks = []
let segmentTimer = null
let totalTimer = null
let tickTimer = null
let isActive = false

const SEGMENT_MS = 3 * 60 * 1000
const MAX_MS = 10 * 60 * 1000

export function isVoiceSupported() {
  return !!(navigator.mediaDevices?.getUserMedia)
}

export async function startRecording({ onTranscript, onError, onTime, onStop }) {
  if (isActive) return
  isActive = true

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000 },
    })
  } catch (err) {
    isActive = false
    onError(`Mic blocked: ${err.message}`)
    return
  }

  let elapsed = 0
  tickTimer = setInterval(() => { elapsed++; onTime?.(elapsed) }, 1000)
  totalTimer = setTimeout(() => stopRecording(onStop), MAX_MS)

  runSegment(onTranscript, onError, onStop)
}

function runSegment(onTranscript, onError, onStop) {
  if (!isActive || !stream) return
  chunks = []

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(t => MediaRecorder.isTypeSupported(t)) || ''

  let mr
  try {
    mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 16000 })
  } catch {
    mr = new MediaRecorder(stream)
  }
  mediaRecorder = mr

  mr.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data) }
  mr.onstop = async () => {
    if (chunks.length) {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      await transcribeBlob(blob, onTranscript, onError)
    }
    if (isActive) runSegment(onTranscript, onError, onStop)
  }

  mr.start(500)
  segmentTimer = setTimeout(() => {
    if (mr.state === 'recording') mr.stop()
  }, SEGMENT_MS)
}

export function stopRecording(onStop) {
  isActive = false
  clearInterval(tickTimer)
  clearTimeout(totalTimer)
  clearTimeout(segmentTimer)
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  onStop?.()
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

async function transcribeBlob(blob, onTranscript, onError) {
  try {
    const base64 = arrayBufferToBase64(await blob.arrayBuffer())
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mimeType: blob.type || 'audio/webm' }),
    })
    if (!res.ok) { onError?.(`Transcribe failed (${res.status})`); return }
    const { transcript, error } = await res.json()
    if (error) { onError?.(error); return }
    if (transcript?.trim()) onTranscript?.(transcript.trim())
  } catch (err) {
    onError?.(`Transcribe error: ${err.message}`)
  }
}
