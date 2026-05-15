// Uses Web Speech API — free, built into every browser, no API key needed

let recognition = null

export function isVoiceSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
}

export function startVoice({ onResult, onError, onStart, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) {
    onError('Voice not supported in this browser. Try Chrome.')
    return null
  }

  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'
  recognition.maxAlternatives = 1

  let finalTranscript = ''

  recognition.onstart = () => onStart?.()

  recognition.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalTranscript += t + ' '
      else interim = t
    }
    onResult({ final: finalTranscript.trim(), interim: interim.trim() })
  }

  recognition.onerror = (e) => {
    onError(`Voice error: ${e.error}`)
  }

  recognition.onend = () => {
    onEnd?.(finalTranscript.trim())
    finalTranscript = ''
  }

  recognition.start()
  return recognition
}

export function stopVoice() {
  if (recognition) {
    recognition.stop()
    recognition = null
  }
}
