import React, { useState, useRef } from 'react'
import { checkBridge, getBridgeUrl, setBridgeUrl } from '../services/api'

/* Angular B logo — matches the actual Builtix logo structure */
function BLogo({ size = 28, color = '#00ff00', glow = false }) {
  return (
    <svg
      viewBox="0 0 80 100"
      width={size}
      height={size * 1.25}
      style={glow ? { filter: 'drop-shadow(0 0 6px #00ff00aa)' } : {}}
    >
      <path
        fill={color}
        fillRule="evenodd"
        d="
          M 5,5 L 5,95 L 48,95 L 62,88 L 72,74 L 72,60 L 57,52 L 72,44
          L 72,24 L 62,10 L 48,5 Z
          M 19,15 L 46,15 L 56,22 L 56,44 L 46,48 L 19,48 Z
          M 19,60 L 42,60 L 33,76 L 42,92 L 19,92 Z
        "
      />
    </svg>
  )
}

export default function StatusHeader({ project, isRunning, onCopy }) {
  const [showModal, setShowModal] = useState(false)
  const [inputUrl, setInputUrl] = useState(getBridgeUrl)
  const [status, setStatus] = useState(null) // null | 'checking' | 'ok' | 'fail'
  const isLocal = !!getBridgeUrl()

  async function handleConnect() {
    setStatus('checking')
    const url = inputUrl.trim()
    const ok = await checkBridge(url || 'http://localhost:3001')
    if (ok) {
      setBridgeUrl(url || 'http://localhost:3001')
      setStatus('ok')
      setTimeout(() => setShowModal(false), 800)
    } else {
      setStatus('fail')
    }
  }

  function handleDisconnect() {
    setBridgeUrl('')
    setInputUrl('')
    setStatus(null)
    setShowModal(false)
  }

  return (
    <>
      <div style={s.bar}>

        {/* Left — logo + sonar pulse */}
        <div style={s.left}>
          <div style={s.logoWrap}
            onPointerDown={e => { e.preventDefault(); window.location.reload() }}
            title="Tap to reload"
          >
            {isRunning && <>
              <div className="sonar-ring" />
              <div className="sonar-ring" />
              <div className="sonar-ring" />
            </>}
            <BLogo size={22} color="#00ff00" glow={isRunning} />
          </div>
          <span style={s.wordmark}>BUILTIX</span>
        </div>

        {/* Right */}
        <div style={s.right}>
          {project && <span style={s.project}>{project}</span>}

          {/* Local bridge toggle */}
          <button
            style={{ ...s.iconBtn, ...(isLocal ? s.localActive : {}) }}
            onPointerDown={e => { e.preventDefault(); setShowModal(true) }}
            title={isLocal ? 'Local bridge active — tap to change' : 'Connect local Termux bridge'}
          >
            <span style={{ fontSize: 12 }}>🔌</span>
          </button>

          <button style={s.iconBtn} onPointerDown={e => { e.preventDefault(); onCopy?.() }} title="Copy selection">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round">
              <rect x="7" y="7" width="10" height="10" rx="2" />
              <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
            </svg>
          </button>
          <div style={{ ...s.dot, background: isRunning ? '#00ff00' : isLocal ? '#44aaff55' : 'rgba(255,255,255,0.18)' }} />
        </div>

      </div>

      {/* Bridge modal */}
      {showModal && (
        <div style={s.overlay} onPointerDown={() => setShowModal(false)}>
          <div style={s.modal} onPointerDown={e => e.stopPropagation()}>
            <div style={s.modalTitle}>🔌 Local Bridge</div>
            <div style={s.modalDesc}>
              Run bridge/start.sh in Termux,{'\n'}then enter the URL below:
            </div>
            <input
              style={s.input}
              value={inputUrl}
              onChange={e => { setInputUrl(e.target.value); setStatus(null) }}
              placeholder="http://localhost:3001"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {status === 'checking' && <div style={s.statusMsg}>Connecting…</div>}
            {status === 'ok'       && <div style={{ ...s.statusMsg, color: '#00ff00' }}>✓ Connected!</div>}
            {status === 'fail'     && <div style={{ ...s.statusMsg, color: '#ff4444' }}>✗ No response — is bridge running?</div>}
            <div style={s.btnRow}>
              {isLocal && (
                <button style={s.btnDanger} onPointerDown={handleDisconnect}>
                  Disconnect
                </button>
              )}
              <button style={s.btnPrimary} onPointerDown={handleConnect}>
                {status === 'checking' ? 'Checking…' : 'Connect'}
              </button>
            </div>
            <div style={s.hint}>
              No bridge? Tap × and use Groq cloud mode.
            </div>
            <button style={s.closeBtn} onPointerDown={() => setShowModal(false)}>×</button>
          </div>
        </div>
      )}
    </>
  )
}

const s = {
  bar: {
    height: 48,
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 14px',
    flexShrink: 0,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    cursor: 'pointer',
  },
  wordmark: {
    color: 'var(--white)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 3,
    fontFamily: "'Inter', sans-serif",
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  project: {
    color: 'var(--grey)',
    fontSize: 10,
    fontFamily: "'Inter', sans-serif",
    letterSpacing: 0.5,
    maxWidth: 100,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  iconBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 7,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  localActive: {
    border: '1px solid #44aaff66',
    background: '#44aaff11',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    transition: 'background 0.3s',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#131e13',
    border: '1px solid #1e2e1e',
    borderRadius: 16,
    padding: '24px 20px 20px',
    width: 'min(320px, 90vw)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Inter', sans-serif",
  },
  modalDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontFamily: "'Inter', sans-serif",
    lineHeight: 1.6,
    whiteSpace: 'pre-line',
  },
  input: {
    background: '#0a1508',
    border: '1px solid #1e2e1e',
    borderRadius: 10,
    color: '#e8e8e8',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    padding: '10px 12px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  statusMsg: {
    fontSize: 12,
    fontFamily: "'Inter', sans-serif",
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  btnRow: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  btnPrimary: {
    flex: 1,
    height: 40,
    background: '#00ff00',
    border: 'none',
    borderRadius: 10,
    color: '#000',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
  },
  btnDanger: {
    height: 40,
    background: 'transparent',
    border: '1px solid #ff444466',
    borderRadius: 10,
    color: '#ff4444',
    fontWeight: 600,
    fontSize: 12,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    padding: '0 14px',
  },
  hint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontFamily: "'Inter', sans-serif",
    textAlign: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 12,
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
    padding: 0,
  },
}
