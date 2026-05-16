import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

import StatusHeader from './components/StatusHeader.jsx'
import TabBar from './components/TabBar.jsx'
import ExtraKeysBar from './components/ExtraKeysBar.jsx'
import InputBar from './components/InputBar.jsx'
import ActionBar from './components/ActionBar.jsx'

import { streamChat, detectBridge, isBridgeActive } from './services/api.js'
import { startRecording, stopRecording, isVoiceSupported } from './services/voice.js'
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

// highlight every occurrence of "biyatrix" in green (case-insensitive)
function highlight(line) {
  return line.replace(/biyatrix/gi, m => `${GREEN}${m}${RESET}\x1b[97m`)
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
  `${WHITE}> Welcome to ${GREEN}Biyatrix${RESET}${WHITE} — build anything from your phone.${RESET}`,
  `${DIM}> ─────────────────────────────────${RESET}`,
  `${WHITE}> /help   → all commands & shortcuts${RESET}`,
  `${WHITE}> /ls     → list your files${RESET}`,
  `${WHITE}> 🎙 VOICE → speak your task to ${GREEN}Biyatrix${RESET}`,
  `${DIM}> ─────────────────────────────────${RESET}`,
  '',
]

function colorize(line) {
  if (line.includes('\x1b[')) return line
  if (line === '') return ''

  // Claude Code-style process lines — no > prefix
  if (line.startsWith('●'))                        return `${GREEN}${highlight(line)}${RESET}`
  if (line.match(/^\s+↳/) || line.startsWith('↳')) return `${DIM}${CYAN}${line}${RESET}`
  if (line.startsWith('────') || line.startsWith('── ')) return `${DIM}${line}${RESET}`

  const prefix = `${DIM}>${RESET} `
  if (line.startsWith('✓')) return `${GREEN}${highlight(line)}${RESET}`
  if (line.startsWith('✗')) return `${RED}${line}${RESET}`
  if (line.startsWith('⚠')) return `${YELLOW}${highlight(line)}${RESET}`
  if (line.startsWith('→')) return `${CYAN}${highlight(line)}${RESET}`
  if (line.startsWith('Built:') || line.startsWith('How to')) return `${WHITE}${line}${RESET}`
  if (line.startsWith('[Step')) return `${prefix}${WHITE}${highlight(line)}${RESET}`
  if (line.startsWith('⟹')) return `${prefix}${PURPLE}${highlight(line)}${RESET}`
  if (line.startsWith('  📁') || line.startsWith('  📄')) return `${prefix}${CYAN}${line}${RESET}`

  return `${prefix}${WHITE}${highlight(line)}${RESET}`
}

export default function App() {
  const termRef = useRef(null)
  const xtermRef = useRef(null)
  const fitRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const decisionLog = useRef([])
  const audioCtxRef = useRef(null)

  function beep() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.08)
    } catch {}
  }


  const firstTab = { ...makeTab(1), lines: [...WELCOME_LINES] }
  const [tabs, setTabs] = useState([firstTab])
  const [activeTabId, setActiveTabId] = useState(firstTab.id)
  const tabsRef = useRef([firstTab])
  const activeTabIdRef = useRef(firstTab.id)

  const [input, setInput] = useState('')
  const [uiOverlay, setUiOverlay] = useState(null)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [snakeActive, setSnakeActive] = useState(false)
  const snakeRef = useRef(null)
  const [taskName, setTaskName] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [voicePreview, setVoicePreview] = useState('')
  const [recTime, setRecTime] = useState(0)
  const [ttsOn, setTtsOn] = useState(() => localStorage.getItem('bx_tts') === '1')
  const ttsOnRef = useRef(false)
  const [attachment, setAttachment] = useState(null)
  const [histIdx, setHistIdx] = useState(-1)
  const [copyToast, setCopyToast] = useState('')
  const [selectMode, setSelectMode] = useState(false)

  // keep refs in sync
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { ttsOnRef.current = ttsOn }, [ttsOn])

  function ttsSpeak(text) {
    if (!ttsOnRef.current || !text?.trim()) return
    const clean = text.replace(/[●↳✓✗⚠→\x1b\[[0-9;]*m]/g, '').trim()
    if (!clean) return
    const utt = new SpeechSynthesisUtterance(clean)
    utt.rate = 1.1
    utt.volume = 0.9
    speechSynthesis.speak(utt)
  }

  function toggleTTS() {
    setTtsOn(prev => {
      const next = !prev
      localStorage.setItem('bx_tts', next ? '1' : '0')
      if (!next) speechSynthesis.cancel()
      return next
    })
  }

  // auto-detect local bridge on load, re-check every 10s
  useEffect(() => {
    async function check() {
      const active = await detectBridge()
      setBridgeActive(active)
    }
    check()
    const id = setInterval(check, 10000)
    return () => clearInterval(id)
  }, [])

  // live elapsed timer while running
  useEffect(() => {
    if (isRunning) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [isRunning])

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
          setCopyToast('✓ Copied selection')
          setTimeout(() => setCopyToast(''), 1500)
        }).catch(() => {})
      }
    })

    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(termRef.current)

    // Smooth touch scroll — xterm only handles wheel, not touch swipe
    let touchStartY = 0
    let lastY = 0
    let velocity = 0
    let rafId = null

    function onTouchStart(e) {
      touchStartY = e.touches[0].clientY
      lastY = touchStartY
      velocity = 0
      if (rafId) cancelAnimationFrame(rafId)
    }

    function onTouchMove(e) {
      const y = e.touches[0].clientY
      const dy = lastY - y
      lastY = y
      velocity = dy
      term.scrollLines(Math.round(dy / 18))
    }

    function onTouchEnd() {
      // momentum scroll
      function momentum() {
        if (Math.abs(velocity) < 0.5) return
        term.scrollLines(Math.round(velocity / 18))
        velocity *= 0.85
        rafId = requestAnimationFrame(momentum)
      }
      rafId = requestAnimationFrame(momentum)
    }

    const el = termRef.current
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      ro.disconnect()
      term.dispose()
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      if (rafId) cancelAnimationFrame(rafId)
    }
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

  // ── Dragon game ──────────────────────────────────────────────────────

  const SCOLS = 42, SROWS = 22

  function snakeFood(snake) {
    const taken = new Set(snake.map(([r, c]) => `${r},${c}`))
    let pos
    do {
      pos = [Math.floor(Math.random() * SROWS), Math.floor(Math.random() * SCOLS)]
    } while (taken.has(`${pos[0]},${pos[1]}`))
    return pos
  }

  function buildSnakeFrame() {
    const g = snakeRef.current
    if (!g) return []
    const { snake, food, score } = g
    const head = `${snake[0][0]},${snake[0][1]}`
    const body = new Set(snake.map(([r, c]) => `${r},${c}`))
    const G = '\x1b[32m', BG = '\x1b[92m', R = '\x1b[91m', D = '\x1b[2m', X = '\x1b[0m'
    const lines = [`${G}╔${'═'.repeat(SCOLS)}╗${X}`]
    for (let r = 0; r < SROWS; r++) {
      let row = `${G}║${X}`
      for (let c = 0; c < SCOLS; c++) {
        const k = `${r},${c}`
        if (k === head)          row += `${BG}◉${X}`
        else if (body.has(k))    row += `${G}█${X}`
        else if (food && r === food[0] && c === food[1]) row += `${R}◆${X}`
        else row += ' '
      }
      row += `${G}║${X}`
      lines.push(row)
    }
    lines.push(`${G}╚${'═'.repeat(SCOLS)}╝${X}`)
    lines.push(`${D}  score: ${score}   ↑↓←→ to fly   ESC to quit${X}`)
    return lines
  }

  function redrawSnake() {
    const lines = buildSnakeFrame()
    const up = `\x1b[${lines.length}A`
    let out = up
    for (const l of lines) out += `\r\x1b[2K${l}\n`
    xtermRef.current?.write(out)
  }

  function startSnake() {
    const cx = Math.floor(SCOLS / 2), cy = Math.floor(SROWS / 2)
    const snake = [[cy, cx], [cy, cx - 1], [cy, cx - 2]]
    snakeRef.current = {
      snake, dir: [0, 1], nextDir: [0, 1],
      food: snakeFood(snake), score: 0,
    }
    writeDivider()
    write('🐉 Dragon — ↑↓←→ to fly · ESC to quit')
    writeDivider()
    const lines = buildSnakeFrame()
    lines.forEach(l => {
      xtermRef.current?.writeln(l)
      setTabs(prev => prev.map(t =>
        t.id === activeTabIdRef.current ? { ...t, lines: [...t.lines, l] } : t
      ))
    })
    setSnakeActive(true)
  }

  function endSnake(reason) {
    const score = snakeRef.current?.score ?? 0
    snakeRef.current = null
    setSnakeActive(false)
    write('')
    write(`✗ ${reason}`)
    write(`✓ Dragon score: ${score}`)
    writeDivider()
  }

  useEffect(() => {
    if (!snakeActive) return
    const id = setInterval(() => {
      const g = snakeRef.current
      if (!g) return
      g.dir = [...g.nextDir]
      const [hr, hc] = g.snake[0]
      const nr = hr + g.dir[0], nc = hc + g.dir[1]
      if (nr < 0 || nr >= SROWS || nc < 0 || nc >= SCOLS) {
        clearInterval(id); endSnake('Hit the wall!'); return
      }
      const bodySet = new Set(g.snake.map(([r, c]) => `${r},${c}`))
      if (bodySet.has(`${nr},${nc}`)) {
        clearInterval(id); endSnake('Hit yourself!'); return
      }
      g.snake.unshift([nr, nc])
      if (nr === g.food[0] && nc === g.food[1]) {
        g.score += 10
        g.food = snakeFood(g.snake)
      } else {
        g.snake.pop()
      }
      redrawSnake()
    }, 650)
    return () => clearInterval(id)
  }, [snakeActive])

  // ── Tab management ──────────────────────────────────────────────────

  function switchTab(tabId) {
    if (tabId === activeTabIdRef.current) return
    setActiveTabId(tabId)
    activeTabIdRef.current = tabId
    setInput('')
    setHistIdx(-1)
    setUiOverlay(null)
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
          setUiOverlay(null)
          write(`✓ New project: ${name}`)
          return
        case '/history':
          write('─── Command History ───')
          newHist.slice(0, 20).forEach((h, i) => write(`  ${i + 1}. ${h}`))
          return
        case '/help':
          getHelpText().forEach(l => { termWrite(l) })
          return
        case '/dragon':
          startSnake()
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
      sessionId: tab.id,
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case 'text':
            // text may be a single line or a multi-line block — handle both
            event.text.split('\n').forEach(l => {
              write(l)
              assistantText += l + '\n'
              if (l.startsWith('⟹')) decisionLog.current.push(l)
              ttsSpeak(l)
            })
            if (event.text.startsWith('●') && !taskName) {
              setTaskName(event.text.replace('●', '').replace(/\.\.\.$/, '').trim().slice(0, 28))
            }
            break
          case 'ui_inject':
            setUiOverlay(event.html)
            write('↳ UI loaded — interactive overlay is live')
            break
          case 'tool_call':
            termWrite(`\x1b[36m${event.text}\x1b[0m`)
            break
          case 'bash_line':
            writeDim(event.text)
            beep()
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
            setTaskName('')
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
    setTaskName('')
  }

  function handleMic() {
    if (isListening) {
      stopRecording(() => {
        setIsListening(false)
        setRecTime(0)
        if (voicePreview) writeDim('🎙 Transcribed — press ↵ to send')
        inputRef.current?.focus()
      })
      return
    }
    if (!isVoiceSupported()) { write('✗ Mic not available in this browser.'); return }
    setVoicePreview('')
    setRecTime(0)
    setIsListening(true)
    writeDim('🎙 Recording… tap STOP when done (max 10 min)')
    startRecording({
      onTranscript: (text) => {
        setVoicePreview(prev => prev ? prev + ' ' + text : text)
      },
      onError: (err) => { write(`✗ ${err}`); setIsListening(false); setRecTime(0) },
      onTime: (t) => setRecTime(t),
      onStop: () => { setIsListening(false); setRecTime(0) },
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
    // Try xterm selection first, fall back to copying all tab lines
    const sel = xtermRef.current?.getSelection()
    const text = sel || getActiveTab()?.lines
      .map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))  // strip ANSI codes
      .join('\n')
      .trim()
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => {
      setCopyToast(sel ? '✓ Copied selection' : '✓ Copied all output')
      setTimeout(() => setCopyToast(false), 1800)
    }).catch(() => {})
  }

  const handleExtraKey = useCallback((k) => {
    if (snakeActive) {
      const g = snakeRef.current
      if (g) {
        if (k.type === 'history' && k.dir === 'UP'    && g.dir[0] !== 1)  g.nextDir = [-1, 0]
        if (k.type === 'history' && k.dir === 'DOWN'  && g.dir[0] !== -1) g.nextDir = [1, 0]
        if (k.type === 'cursor'  && k.dir === 'LEFT'  && g.dir[1] !== 1)  g.nextDir = [0, -1]
        if (k.type === 'cursor'  && k.dir === 'RIGHT' && g.dir[1] !== -1) g.nextDir = [0, 1]
      }
      if (k.type === 'esc') endSnake('Game quit.')
      return
    }
    if (k.type === 'ctrl') {
      const key = k.key?.toUpperCase()
      if (key === 'C' || key === '■') handleStop()
      if (key === 'L') {
        xtermRef.current?.clear()
        setTabs(prev => prev.map(t => t.id === activeTabIdRef.current ? { ...t, lines: [] } : t))
      }
      return
    }
    if (k.type === 'select') { setSelectMode(prev => !prev); return }
    if (k.type === 'esc') { setSelectMode(false); setInput(''); setVoicePreview(''); return }
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
  }, [histIdx, snakeActive])

  const activeTab = tabs.find(t => t.id === activeTabId)

  return (
    <div style={styles.root}>
      <StatusHeader
        project={activeTab?.name || ''}
        isRunning={isRunning}
        onCopy={handleCopy}
        bridgeActive={bridgeActive}
      />
      <TabBar
        tabs={tabs}
        activeTab={activeTabId}
        onSwitch={switchTab}
        onNew={newTab}
        onClose={closeTab}
        onRename={renameTab}
      />
      {copyToast && <div style={styles.toast}>{copyToast}</div>}
      {isRunning && (
        <div style={styles.taskPill}>
          <span style={styles.taskDot}>●</span>
          <span style={styles.taskLabel}>{taskName || 'Working…'}</span>
          <span style={styles.taskSep}>·</span>
          <span style={styles.taskTimer}>{elapsed}s</span>
          <span style={styles.taskSep}>·</span>
          <button style={styles.escBtn} onPointerDown={e => { e.preventDefault(); handleStop() }}>
            ESC to stop
          </button>
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={termRef} style={{ ...styles.terminal, visibility: selectMode ? 'hidden' : 'visible' }} onClick={() => inputRef.current?.focus()} />
        {uiOverlay && (
          <div style={styles.uiOverlay}>
            <button style={styles.uiClose} onPointerDown={() => setUiOverlay(null)}>✕ close</button>
            <iframe
              srcDoc={uiOverlay}
              style={styles.uiFrame}
              sandbox="allow-scripts"
              title="biyatrix-ui"
            />
          </div>
        )}
        {selectMode && (
          <div style={styles.selectOverlay}>
            <pre style={styles.selectText}>
              {getActiveTab()?.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')}
            </pre>
          </div>
        )}
      </div>
      <ExtraKeysBar onKey={handleExtraKey} selectMode={selectMode} />
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
        onTTSToggle={toggleTTS}
        isListening={isListening}
        isRunning={isRunning}
        hasFile={!!attachment}
        ttsOn={ttsOn}
        recTime={recTime}
      />
    </div>
  )
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', background: 'var(--bg)', overflow: 'hidden', position: 'relative' },
  terminal: { width: '100%', height: '100%' },
  selectOverlay: {
    position: 'absolute', inset: 0,
    background: 'var(--bg)',
    overflowY: 'auto',
    padding: '10px 12px',
    WebkitOverflowScrolling: 'touch',
  },
  selectText: {
    margin: 0,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.4,
    color: '#ccc',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  uiOverlay: {
    position: 'absolute', inset: 0,
    background: '#0a0a0a',
    display: 'flex', flexDirection: 'column',
    zIndex: 200,
  },
  uiClose: {
    background: 'transparent',
    border: '1px solid rgba(0,255,0,0.3)',
    color: '#00ff00',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11, fontWeight: 700,
    padding: '4px 14px',
    cursor: 'pointer',
    alignSelf: 'flex-end',
    margin: '6px 8px 2px',
    borderRadius: 10,
    letterSpacing: 0.5,
  },
  uiFrame: {
    flex: 1, border: 'none', background: '#0a0a0a',
  },
  toast: {
    position: 'absolute', top: 88, left: '50%', transform: 'translateX(-50%)',
    background: '#00ff00', color: '#000', fontFamily: "'Inter', sans-serif",
    fontSize: 11, fontWeight: 700, padding: '5px 16px',
    borderRadius: 20, zIndex: 100, pointerEvents: 'none', letterSpacing: 1,
  },
  taskPill: {
    position: 'absolute',
    bottom: 152,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(10,21,8,0.88)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '6px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    zIndex: 50,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    whiteSpace: 'nowrap',
  },
  taskDot: {
    color: '#00ff00',
    fontSize: 10,
    animation: 'none',
  },
  taskLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    fontWeight: 500,
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskSep: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
  },
  taskTimer: {
    color: '#00ff00',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 700,
    minWidth: 28,
  },
  escBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 10,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 8px',
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
}
