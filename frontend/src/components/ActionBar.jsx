import React from 'react'

export default function ActionBar({
  onMic, onAttach, onRun, onStop,
  isListening, isRunning, hasFile
}) {
  return (
    <div style={styles.bar}>
      <button
        style={{ ...styles.btn, ...(isListening ? styles.btnRed : {}) }}
        onPointerDown={e => { e.preventDefault(); onMic() }}
      >
        {isListening ? '⏹ STOP' : '🎙 VOICE'}
      </button>

      <button
        style={{ ...styles.btn, ...(hasFile ? styles.btnGreen : {}) }}
        onPointerDown={e => { e.preventDefault(); onAttach() }}
      >
        {hasFile ? '📎 READY' : '📎 FILE'}
      </button>

      {isRunning
        ? <button style={{ ...styles.btn, ...styles.btnRed }} onPointerDown={e => { e.preventDefault(); onStop() }}>
            ■ STOP
          </button>
        : <button style={{ ...styles.btn, ...styles.btnGreen }} onPointerDown={e => { e.preventDefault(); onRun() }}>
            ▶ RUN
          </button>
      }
    </div>
  )
}

const styles = {
  bar: {
    height: 52,
    background: '#080808',
    borderTop: '1px solid #151515',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    gap: 6,
    flexShrink: 0,
  },
  btn: {
    flex: 1,
    height: 36,
    background: '#0d0d0d',
    border: '1px solid #222',
    borderRadius: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  btnGreen: {
    border: '1px solid #006b1a',
    color: '#00ff41',
    background: '#020d02',
  },
  btnRed: {
    border: '1px solid #661111',
    color: '#ff4444',
    background: '#0d0101',
  },
}
