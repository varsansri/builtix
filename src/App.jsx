import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

import StatusHeader from './components/StatusHeader.jsx'
import ExtraKeysBar from './components/ExtraKeysBar.jsx'
import InputBar from './components/InputBar.jsx'
import ActionBar from './components/ActionBar.jsx'

import { streamChat } from './services/api.js'
import { startVoice, stopVoice, isVoiceSupported } from './services/voice.js'
import { parseCommand, getHelpText } from './utils/commandParser.js'
import { TERMINAL_THEME } from './constants/theme.js'

const SESSION_ID = `session_${Date.now()}`

const WELCOME = [
  '',
  '\x1b[32m ██████╗ ██╗   ██╗██╗██╗  ████████╗██╗██╗  ██╗\x1b[0m',
  '\x1b[32m ██╔══██╗██║   ██║██║██║  ╚══██╔══╝██║╚██╗██╔╝\x1b[0m',
  '\x1b[32m ██████╔╝██║   ██║██║██║     ██║   ██║ ╚███╔╝ \x1b[0m',
  '\x1b[32m ██╔══██╗██║   ██║██║██║     ██║   ██║ ██╔██╗ \x1b[0m',
  '\x1b[32m ██████╔╝╚██████╔╝██║███████╗██║   ██║██╔╝ ██╗\x1b[0m',
  '\x1b[32m ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝╚═╝  ╚═╝\x1b[0m',
  '',
  '\x1b[2m Build anything. From your phone.\x1b[0m',
  '\x1b[2m ─────────────────────────────────\x1b[0m',
  ' /help   → all commands',
  ' /ls     → list your files',
  ' 🎙 tap VOICE → speak your task',
  '\x1b[2m ─────────────────────────────────\x1b[0m',
  '',
]

function colorize(line) {
  if (!line && line !== '') return line
  if (line.startsWith('✓')) return `\x1b[32m${line}\x1b[0m`
  if (line.startsWith('✗')) return `\x1b[31m${line}\x1b[0m`
  if (line.startsWith('⚠')) return `\x1b[33m${line}\x1b[0m`
  if (line.startsWith('→')) return `\x1b[36m${line}\x1b[0m`
  if (line.startsWith('[Step')) return `\x1b[97m${line}\x1b[0m`
  if (line.startsWith('⟹')) return `\x1b[35m${line}\x1b[0m`
  if (line.startsWith('────')) return `\x1b[2m${line}\x1b[0m`
  if (line.startsWith('  📁') || line.startsWith('  📄')) return `\x1b[36m${line}\x1b[0m`
  return line
}

export default function App() {
  const termRef = useRef(null)
  const xtermRef = useRef(null)
  const fitRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const decisionLog = useRef([])
  const conversationRef = useRef([])

  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voicePreview, setVoicePreview] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [project, setProject] = useState('new-project')
  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const [copyToast, setCopyToast] = useState(false)

  useEffect(() => {
    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: true,
      disableStdin: true,
      rightClickSelectsWord: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)
    fit.fit()
    xtermRef.current = term
    fitRef.current = fit
    WELCOME.forEach(line => term.writeln(line))

    // auto-copy selected text on mobile
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) {
        navigator.clipboard?.writeText(sel).then(() => {
          setCopyToast(true)
          setTimeout(() => setCopyToast(false), 1500)
        }).catch(() => {})
      }
    })

    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(termRef.current)
    return () => { ro.disconnect(); term.dispose() }
  }, [])

  function write(text) { xtermRef.current?.writeln(colorize(text)) }
  function writeDim(text) { xtermRef.current?.writeln(`\x1b[2m${text}\x1b[0m`) }
  function writeDivider() { writeDim('────────────────────────────────') }

  async function handleSubmit() {
    const text = (voicePreview || input).trim()
    if (!text || isRunning) return
    setInput('')
    setVoicePreview('')

    xtermRef.current?.writeln(`\x1b[32m>\x1b[0m ${text}`)

    const newHist = [text, ...cmdHistory.filter(h => h !== text)].slice(0, 100)
    setCmdHistory(newHist)
    setHistIdx(-1)

    const parsed = parseCommand(text)

    if (parsed.type === 'command') {
      switch (parsed.command) {
        case '/clear': xtermRef.current?.clear(); return
        case '/new':
          const name = parsed.args || 'new-project'
          setProject(name)
          conversationRef.current = []
          xtermRef.current?.clear()
          write(`✓ New project: ${name}`)
          return
        case '/history':
          write('─── Command History ───')
          newHist.slice(0, 20).forEach((h, i) => write(`  ${i + 1}. ${h}`))
          return
        case '/help':
          getHelpText().forEach(l => xtermRef.current?.writeln(l))
          return
        case '/why':
          if (!decisionLog.current.length) { write('⚠ Run a task first.'); return }
          write('─── Decision Log ───')
          decisionLog.current.forEach(l => write(l))
          return
        case '/ls':
          await sendToAI('list the files in the current directory')
          return
        case '/start':
          write('✓ Ready. What do you want to build?')
          return
        default:
          write(`✗ Unknown command. Type /help`)
          return
      }
    }

    await sendToAI(text)
  }

  async function sendToAI(userText) {
    let content = userText
    if (attachment) {
      content = `File: ${attachment.name}\n\n${attachment.content}\n\nTask: ${userText}`
      setAttachment(null)
    }

    conversationRef.current = [
      ...conversationRef.current,
      { role: 'user', content },
    ]

    setIsRunning(true)
    writeDivider()

    const controller = new AbortController()
    abortRef.current = controller

    let assistantText = ''

    await streamChat({
      messages: conversationRef.current,
      sessionId: SESSION_ID,
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case 'text':
            write(event.text)
            assistantText += event.text + '\n'
            if (event.text.startsWith('⟹')) decisionLog.current.push(event.text)
            break

          case 'tool_call':
            xtermRef.current?.writeln(`\x1b[36m${event.text}\x1b[0m`)
            break

          case 'tool_result':
            writeDim('── result ──')
            event.text.split('\n').slice(0, 12).forEach(l => writeDim(l))
            if (event.text.split('\n').length > 12) writeDim('  ...(truncated)')
            writeDim('────────────')
            break

          case 'error':
            xtermRef.current?.writeln(`\x1b[31m${event.text}\x1b[0m`)
            break

          case 'done':
            conversationRef.current = [
              ...conversationRef.current,
              { role: 'assistant', content: assistantText.trim() },
            ]
            setIsRunning(false)
            writeDivider()
            break
        }
      },
      onError: (err) => {
        xtermRef.current?.writeln(`\x1b[31m${err}\x1b[0m`)
        setIsRunning(false)
      },
    })
  }

  function handleStop() {
    abortRef.current?.abort()
    write('⚠ Stopped.')
    setIsRunning(false)
  }

  function handleMic() {
    if (isListening) {
      stopVoice()
      setIsListening(false)
      if (voicePreview) writeDim('🎙 Voice ready — press ↵ to send')
      inputRef.current?.focus()
      return
    }
    if (!isVoiceSupported()) {
      write('✗ Use Chrome on Android for voice.')
      return
    }
    writeDim('🎙 Listening... tap STOP when done.')
    setIsListening(true)
    startVoice({
      onResult: ({ final, interim }) => setVoicePreview(final || interim),
      onError: (err) => { write(`✗ ${err}`); setIsListening(false) },
      onEnd: (final) => { setIsListening(false); if (final) setVoicePreview(final) },
    })
  }

  async function handleAttach() {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.txt,.py,.js,.ts,.jsx,.tsx,.json,.csv,.md,.html,.css,.sh,.env,.log,.yaml,.toml'
    el.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      setAttachment({ name: file.name, content: text })
      write(`📎 Attached: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`)
    }
    el.click()
  }

  const handleExtraKey = useCallback((k) => {
    if (k.type === 'ctrl') {
      const key = k.key?.toUpperCase()
      if (key === 'C' || key === '■') handleStop()
      if (key === 'L') xtermRef.current?.clear()
      return
    }
    if (k.type === 'esc') { setInput(''); setVoicePreview(''); return }
    if (k.type === 'history') {
      const newIdx = k.dir === 'UP'
        ? Math.min(histIdx + 1, cmdHistory.length - 1)
        : Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx === -1 ? '' : cmdHistory[newIdx])
      return
    }
    if (k.type === 'insert') {
      setInput(prev => prev + k.value)
      inputRef.current?.focus()
    }
  }, [histIdx, cmdHistory])

  function handleCopySelected() {
    const sel = xtermRef.current?.getSelection()
    if (sel) {
      navigator.clipboard?.writeText(sel)
      setCopyToast(true)
      setTimeout(() => setCopyToast(false), 1500)
    } else {
      write('⚠ Select text first, then tap copy.')
    }
  }

  return (
    <div style={styles.root}>
      <StatusHeader project={project} isRunning={isRunning} onCopy={handleCopySelected} />
      {copyToast && <div style={styles.toast}>✓ Copied</div>}
      <div ref={termRef} style={styles.terminal} onClick={() => inputRef.current?.focus()} />
      <ExtraKeysBar onKey={handleExtraKey} />
      <InputBar
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isRunning}
        voicePreview={isListening ? voicePreview : ''}
      />
      <ActionBar
        onMic={handleMic}
        onAttach={handleAttach}
        onRun={handleSubmit}
        onStop={handleStop}
        isListening={isListening}
        isRunning={isRunning}
        hasFile={!!attachment}
      />
    </div>
  )
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', background: '#000', overflow: 'hidden' },
  terminal: { flex: 1, overflow: 'hidden', minHeight: 0 },
  toast: {
    position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)',
    background: '#00ff41', color: '#000', fontFamily: 'monospace',
    fontSize: 12, fontWeight: 700, padding: '4px 14px',
    borderRadius: 4, zIndex: 100, pointerEvents: 'none',
  },
}
