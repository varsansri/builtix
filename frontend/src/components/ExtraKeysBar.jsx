import React, { useState } from 'react'

const KEYS = [
  { label: 'ESC',  type: 'esc' },
  { label: 'CTRL', type: 'modifier', mod: 'CTRL' },
  { label: 'ALT',  type: 'modifier', mod: 'ALT' },
  { label: 'TAB',  type: 'insert', value: '\t' },
  { label: '↑',    type: 'history', dir: 'UP' },
  { label: '↓',    type: 'history', dir: 'DOWN' },
  { label: '←',    type: 'cursor', dir: 'LEFT' },
  { label: '→',    type: 'cursor', dir: 'RIGHT' },
  { label: '/',    type: 'insert', value: '/' },
  { label: '|',    type: 'insert', value: '|' },
  { label: '-',    type: 'insert', value: '-' },
  { label: '_',    type: 'insert', value: '_' },
  { label: "'",    type: 'insert', value: "'" },
  { label: '"',    type: 'insert', value: '"' },
  { label: '~',    type: 'insert', value: '~' },
]

export default function ExtraKeysBar({ onKey }) {
  const [activeMod, setActiveMod] = useState(null)

  function handleKey(k) {
    if (k.type === 'modifier') {
      setActiveMod(prev => prev === k.mod ? null : k.mod)
      return
    }
    if (activeMod === 'CTRL') {
      onKey({ type: 'ctrl', key: k.label })
      setActiveMod(null)
      return
    }
    onKey(k)
  }

  return (
    <div style={styles.bar}>
      {KEYS.map(k => {
        const isActive = k.type === 'modifier' && activeMod === k.mod
        return (
          <button
            key={k.label}
            style={{ ...styles.key, ...(isActive ? styles.activeKey : {}) }}
            onPointerDown={e => { e.preventDefault(); handleKey(k) }}
          >
            <span style={{ ...styles.label, ...(isActive ? styles.activeLabel : {}) }}>
              {k.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const styles = {
  bar: {
    height: 36,
    background: '#080808',
    borderTop: '1px solid #151515',
    display: 'flex',
    alignItems: 'center',
    overflowX: 'auto',
    gap: 3,
    padding: '0 4px',
    flexShrink: 0,
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  key: {
    height: 26,
    minWidth: 38,
    padding: '0 8px',
    background: '#0d0d0d',
    border: '1px solid #222',
    borderRadius: 3,
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
  activeKey: {
    background: '#00ff41',
    border: '1px solid #00ff41',
  },
  label: {
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
  },
  activeLabel: {
    color: '#000',
  },
}
