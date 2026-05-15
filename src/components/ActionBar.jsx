import React from 'react'

export default function ActionBar({ onMic, onAttach, onRun, onStop, isListening, isRunning, hasFile }) {
  return (
    <div style={s.bar}>

      {/* Voice */}
      <button
        style={{ ...s.iconBtn, ...(isListening ? s.iconBtnRed : {}) }}
        onPointerDown={e => { e.preventDefault(); onMic() }}
        title={isListening ? 'Stop listening' : 'Voice input'}
      >
        {isListening
          ? <svg viewBox="0 0 20 20" width="18" height="18" fill="#ff4444"><rect x="5" y="5" width="10" height="10" rx="2"/></svg>
          : <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.6" strokeLinecap="round">
              <rect x="7" y="2" width="6" height="9" rx="3"/>
              <path d="M4 10a6 6 0 0 0 12 0"/>
              <line x1="10" y1="17" x2="10" y2="19"/>
            </svg>
        }
      </button>

      {/* Attach */}
      <button
        style={{ ...s.iconBtn, ...(hasFile ? s.iconBtnGreenDim : {}) }}
        onPointerDown={e => { e.preventDefault(); onAttach() }}
        title="Attach file"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none"
          stroke={hasFile ? '#00ff00' : 'rgba(255,255,255,0.6)'}
          strokeWidth="1.6" strokeLinecap="round">
          <path d="M17.5 10.5L9.5 18.5a5 5 0 0 1-7-7l8-8a3 3 0 0 1 4.24 4.24L7 15.5a1 1 0 0 1-1.41-1.41L13 7"/>
        </svg>
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Run / Stop — primary action, big green rounded-square */}
      {isRunning
        ? <button style={{ ...s.primaryBtn, ...s.primaryBtnStop }}
            onPointerDown={e => { e.preventDefault(); onStop() }}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" fill="#ff4444"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>
            <span style={{ ...s.primaryLabel, color: '#ff4444' }}>STOP</span>
          </button>
        : <button style={s.primaryBtn}
            onPointerDown={e => { e.preventDefault(); onRun() }}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" fill="#000"><polygon points="6,3 17,10 6,17"/></svg>
            <span style={s.primaryLabel}>RUN</span>
          </button>
      }

    </div>
  )
}

const s = {
  bar: {
    height: 58,
    background: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 10,
    flexShrink: 0,
  },
  iconBtn: {
    width: 40,
    height: 40,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'background 0.15s',
  },
  iconBtnRed: {
    background: '#1a0505',
    border: '1px solid #661111',
  },
  iconBtnGreenDim: {
    background: '#041004',
    border: '1px solid #1a4a1a',
  },
  primaryBtn: {
    height: 44,
    paddingLeft: 20,
    paddingRight: 20,
    background: 'var(--green)',
    border: 'none',
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  primaryBtnStop: {
    background: '#1a0505',
    border: '1px solid #661111',
  },
  primaryLabel: {
    color: '#000',
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
  },
}
