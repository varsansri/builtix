import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

import StatusHeader from './components/StatusHeader.jsx'
import TabBar from './components/TabBar.jsx'
import ExtraKeysBar from './components/ExtraKeysBar.jsx'
import InputBar from './components/InputBar.jsx'
import ActionBar from './components/ActionBar.jsx'

import { streamChat } from './services/api.js'
import { startVoice, stopVoice, isVoiceSupported } from './services/voice.js'
import { parseCommand, getHelpText } from './utils/commandParser.js'
import { TERMINAL_THEME } from './constants/theme.js'

// shared session so all tabs can read each other's files
const BASE_SESSION = `s_${Date.now()}`

function makeTab(n) {
  return {
    id: `tab_${Date.now()}_${n}`,
    name: `terminal-${n}`,
    conversation: [],
    lines: [],       // stored as raw strings (with ANSI codes)
    cmdHistory: [],
  }
}

const GREEN = '\x1b[32m'
const WHITE = '\x1b[97m'
const DIM   = '\x1b[2m'
const CYAN  = '\x1b[36m'
const RED   = '\x1b[31m'
const YELLOW= '\x1b[33m'
const PURPLE= '\x1b[35m'
const RESET = '\x1b[0m'

// highlight every occurrence of "builtix" in green (case-insensitive)
function highlight(line) {
  return line.replace(/builtix/gi, m => `${GREEN}${m}${RESET}\x1b[97m`)
}

const WELCOME_LINES = [
  '',
  `${GREEN} ██████╗ ██╗   ██╗██╗██╗  ████████╗██╗██╗  ██╗${RESET}`,
  `${GREEN} ██╔══██╗██║   ██║██║██║  ╚══██╔══╝██║╚██╗██╔╝${RESET}`,
  `${GREEN} ██████╔╝██║   ██║██║██║     ██║   ██║ ╚███╔╝ ${RESET}`,
  `${GREEN} ██╔══██╗██║   ██║██║██║     ██║   ██║ ██╔██╗ ${RESET}`,
  `${GREEN} ██████╔╝╚██████╔╝██║███████╗██║   ██║██╔╝ ██╗${RESET}`,
  `${GREEN} ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝╚═╝  ╚═╝${RESET}`,
  '',
  `${WHITE}> Welcome to ${GREEN}Builtix${RESET}${WHITE} — build anything from your phone.${RESET}`,
  `${DIM}> ─────────────────────────────────${RESET}`,
  `${WHITE}> /help   → all commands & shortcuts${RESET}`,
  `${WHITE}> /ls     → list your files${RESET}`,
  `${WHITE}> 🎙 VOICE → speak your task to ${GREEN}Builtix${RESET}`,
  `${DIM}> ─────────────────────────────────${RESET}`,
  '',
]

function colorize(line) {
  // skip lines that already have ANSI codes (welcome, dividers)
  if (line.includes('\x1b[')) return line

  const prefix = `${DIM}>${RESET} `
  const isDiv = line.startsWith('────') || line.startsWith('── ')

  if (isDiv) return `${prefix}${DIM}${line}${RESET}`
  if (line.startsWith('✓')) return `${prefix}${GREEN}${highlight(line)}${RESET}`
  if (line.startsWith('✗')) return `${prefix}${RED}${line}${RESET}`
  if (line.startsWith('⚠')) return `${prefix}${YELLOW}${highlight(line)}${RESET}`
  if (line.startsWith('→')) return `${prefix}${CYAN}${highlight(line)}${RESET}`
  if (line.startsWith('[Step')) return `${prefix}${WHITE}${highlight(line)}${RESET}`
  if (line.startsWith('⟹')) return `${prefix}${PURPLE}${highlight(line)}${RESET}`
  if (line.startsWith('  📁') || line.startsWith('  📄')) return `${prefix}${CYAN}${line}${RESET}`
  if (line === '') return ''

  return `${prefix}${WHITE}${highlight(line)}${RESET}`
}

export default function App() {
  const termRef = useRef(null)
  const xtermRef = useRef(null)
  const fitRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const decisionLog = useRef([])

  const firstTab = { ...makeTab(1), lines: [...WELCOME_LINES] }
  const [tabs, setTabs] = useState([firstTab])
  const [activeTabId, setActiveTabId] = useState(firstTab.id)
  const tabsRef = useRef([firstTab])
  const activeTabIdRef = useRef(firstTab.id)

  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voicePreview, setVoicePreview] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [histIdx, setHistIdx] = useState(-1)
  const [copyToast, setCopyToast] = useState(false)

  // keep refs in sync
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  useEffect(() => {
    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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

    WELCOME_LINES.forEach(l => term.writeln(l))

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

  // ── Terminal write helpers ──────────────────────────────────────────

  function termWrite(raw) {
    xtermRef.current?.writeln(raw)
    setTabs(prev => prev.map(t =>
      t.id === activeTabIdRef.current ? { ...t, lines: [...t.lines, raw] } : t
    ))
  }

  function write(text) { termWrite(colorize(text)) }
  function writeDim(t) { termWrite(`\x1b[2m${t}\x1b[0m`) }
  function writeDivider() { writeDim('────────────────────────────────') }

  function replayTab(tabId) {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab || !xtermRef.current) return
    xtermRef.current.clear()
    tab.lines.forEach(l => xtermRef.current.writeln(l))
    xtermRef.current.scrollToBottom()
  }

  // ── Tab management ──────────────────────────────────────────────────

  function switchTab(tabId) {
    if (tabId === activeTabIdRef.current) return
    setActiveTabId(tabId)
    activeTabIdRef.current = tabId
    setInput('')
    setHistIdx(-1)
    replayTab(tabId)
  }

  function newTab() {
    const n = tabsRef.current.length + 1
    const tab = { ...makeTab(n), lines: [...WELCOME_LINES] }
    setTabs(prev => [...prev, tab])
    tabsRef.current = [...tabsRef.current, tab]
    switchTab(tab.id)
  }

  function closeTab(tabId) {
    const remaining = tabsRef.current.filter(t => t.id !== tabId)
    setTabs(remaining)
    tabsRef.current = remaining
    if (activeTabIdRef.current === tabId) {
      const next = remaining[remaining.length - 1]
      setActiveTabId(next.id)
      activeTabIdRef.current = next.id
      replayTab(next.id)
    }
  }

  function renameTab(tabId, name) {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, name } : t))
  }

  // ── Active tab data helpers ─────────────────────────────────────────

  function getActiveTab() {
    return tabsRef.current.find(t => t.id === activeTabIdRef.current)
  }

  function updateActiveConversation(conv) {
    setTabs(prev => prev.map(t =>
      t.id === activeTabIdRef.current ? { ...t, conversation: conv } : t
    ))
    tabsRef.current = tabsRef.current.map(t =>
      t.id === activeTabIdRef.current ? { ...t, conversation: conv } : t
    )
  }

  function updateActiveCmdHistory(hist) {
    setTabs(prev => prev.map(t =>
      t.id === activeTabIdRef.current ? { ...t, cmdHistory: hist } : t
    ))
    tabsRef.current = tabsRef.current.map(t =>
      t.id === activeTabIdRef.current ? { ...t, cmdHistory: hist } : t
    )
  }

  // ── Command handling ────────────────────────────────────────────────

  async function handleSubmit() {
    const text = (voicePreview || input).trim()
    if (!text || isRunning) return
    setInput('')
    setVoicePreview('')

    write(`\x1b[32m>\x1b[0m ${text}`)

    const tab = getActiveTab()
    const newHist = [text, ...tab.cmdHistory.filter(h => h !== text)].slice(0, 100)
    updateActiveCmdHistory(newHist)
    setHistIdx(-1)

    const parsed = parseCommand(text)

    if (parsed.type === 'command') {
      switch (parsed.command) {
        case '/clear':
          xtermRef.current?.clear()
          setTabs(prev => prev.map(t => t.id === activeTabIdRef.current ? { ...t, lines: [] } : t))
          return
        case '/new':
          const name = parsed.args || 'new-project'
          updateActiveConversation([])
          xtermRef.current?.clear()
          setTabs(prev => prev.map(t => t.id === activeTabIdRef.current ? { ...t, lines: [], name } : t))
          write(`✓ New project: ${name}`)
          return
        case '/history':
          write('─── Command History ───')
          newHist.slice(0, 20).forEach((h, i) => write(`  ${i + 1}. ${h}`))
          return
        case '/help':
          getHelpText().forEach(l => { termWrite(l) })
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
    const tab = getActiveTab()
    let content = userText
    if (attachment) {
      content = `File: ${attachment.name}\n\n${attachment.content}\n\nTask: ${userText}`
      setAttachment(null)
    }

    const newConvo = [...tab.conversation, { role: 'user', content }]
    updateActiveConversation(newConvo)

    setIsRunning(true)
    writeDivider()

    const controller = new AbortController()
    abortRef.current = controller
    let assistantText = ''

    await streamChat({
      messages: newConvo,
      sessionId: BASE_SESSION,
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case 'text':
            write(event.text)
            assistantText += event.text + '\n'
            if (event.text.startsWith('⟹')) decisionLog.current.push(event.text)
            break
          case 'tool_call':
            termWrite(`\x1b[36m${event.text}\x1b[0m`)
            break
          case 'tool_result':
            writeDim('── result ──')
            event.text.split('\n').slice(0, 10).forEach(l => writeDim(l))
            if (event.text.split('\n').length > 10) writeDim('  ...')
            writeDim('────────────')
            break
          case 'error':
            termWrite(`\x1b[31m${event.text}\x1b[0m`)
            break
          case 'done':
            updateActiveConversation([...newConvo, { role: 'assistant', content: assistantText.trim() }])
            setIsRunning(false)
            writeDivider()
            break
        }
      },
      onError: (err) => {
        termWrite(`\x1b[31m${err}\x1b[0m`)
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
    if (!isVoiceSupported()) { write('✗ Use Chrome on Android for voice.'); return }
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

  function handleCopy() {
    const sel = xtermRef.current?.getSelection()
    if (sel) {
      navigator.clipboard?.writeText(sel)
      setCopyToast(true)
      setTimeout(() => setCopyToast(false), 1500)
    } else {
      write('⚠ Select text first, then tap ⎘')
    }
  }

  const handleExtraKey = useCallback((k) => {
    if (k.type === 'ctrl') {
      const key = k.key?.toUpperCase()
      if (key === 'C' || key === '■') handleStop()
      if (key === 'L') {
        xtermRef.current?.clear()
        setTabs(prev => prev.map(t => t.id === activeTabIdRef.current ? { ...t, lines: [] } : t))
      }
      return
    }
    if (k.type === 'esc') { setInput(''); setVoicePreview(''); return }
    if (k.type === 'history') {
      const tab = getActiveTab()
      const hist = tab?.cmdHistory || []
      const newIdx = k.dir === 'UP'
        ? Math.min(histIdx + 1, hist.length - 1)
        : Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx === -1 ? '' : hist[newIdx])
      return
    }
    if (k.type === 'insert') {
      setInput(prev => prev + k.value)
      inputRef.current?.focus()
    }
  }, [histIdx])

  const activeTab = tabs.find(t => t.id === activeTabId)

  return (
    <div style={styles.root}>
      <StatusHeader
        project={activeTab?.name || ''}
        isRunning={isRunning}
        onCopy={handleCopy}
      />
      <TabBar
        tabs={tabs}
        activeTab={activeTabId}
        onSwitch={switchTab}
        onNew={newTab}
        onClose={closeTab}
        onRename={renameTab}
      />
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
  root: { display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', background: 'var(--bg)', overflow: 'hidden' },
  terminal: { flex: 1, overflow: 'hidden', minHeight: 0 },
  toast: {
    position: 'absolute', top: 88, left: '50%', transform: 'translateX(-50%)',
    background: '#00ff00', color: '#000', fontFamily: "'Inter', sans-serif",
    fontSize: 11, fontWeight: 700, padding: '5px 16px',
    borderRadius: 20, zIndex: 100, pointerEvents: 'none', letterSpacing: 1,
  },
}
