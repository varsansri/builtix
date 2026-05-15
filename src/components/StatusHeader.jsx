import React from 'react'

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

export default function StatusHeader({ project, isRunning, onCopy, bridgeActive }) {
  return (
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
        {bridgeActive && (
          <span style={s.localBadge} title="Connected to local Termux bridge">LOCAL</span>
        )}
      </div>

      {/* Right */}
      <div style={s.right}>
        {project && <span style={s.project}>{project}</span>}
        <button style={s.iconBtn} onPointerDown={e => { e.preventDefault(); onCopy?.() }} title="Copy selection">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round">
            <rect x="7" y="7" width="10" height="10" rx="2" />
            <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          </svg>
        </button>
        <div style={{ ...s.dot, background: isRunning ? '#00ff00' : bridgeActive ? '#44aaff' : 'rgba(255,255,255,0.18)' }} />
      </div>

    </div>
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
  localBadge: {
    fontSize: 9,
    fontWeight: 700,
    fontFamily: "'Inter', sans-serif",
    letterSpacing: 1,
    color: '#44aaff',
    background: '#44aaff18',
    border: '1px solid #44aaff44',
    borderRadius: 4,
    padding: '2px 6px',
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
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    transition: 'background 0.3s',
  },
}
