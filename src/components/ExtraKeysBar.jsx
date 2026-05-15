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
    <div style={s.bar}>
      {KEYS.map(k => {
        const active = k.type === 'modifier' && activeMod === k.mod
        return (
          <button
            key={k.label}
            style={{ ...s.key, ...(active ? s.keyActive : {}) }}
            onPointerDown={e => { e.preventDefault(); handleKey(k) }}
          >
            <span style={{ ...s.label, ...(active ? s.labelActive : {}) }}>
              {k.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const s = {
  bar: {
    height: 38,
    background: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    overflowX: 'auto',
    gap: 4,
    padding: '0 8px',
    flexShrink: 0,
    scrollbarWidth: 'none',
  },
  key: {
    height: 26,
    minWidth: 38,
    padding: '0 8px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    transition: 'background 0.1s',
  },
  keyActive: {
    background: 'var(--green)',
    border: '1px solid var(--green)',
  },
  label: {
    color: 'var(--grey)',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
  },
  labelActive: {
    color: '#000',
  },
}
