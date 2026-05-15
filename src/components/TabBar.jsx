import React, { useState, useRef } from 'react'

export default function TabBar({ tabs, activeTab, onSwitch, onNew, onClose, onRename }) {
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const pressTimer = useRef(null)

  function handlePressStart(tab) {
    pressTimer.current = setTimeout(() => {
      setEditingId(tab.id)
      setEditValue(tab.name)
    }, 600)
  }

  function handlePressEnd() {
    clearTimeout(pressTimer.current)
  }

  function handleRenameSubmit(id) {
    if (editValue.trim()) onRename(id, editValue.trim())
    setEditingId(null)
  }

  return (
    <div style={s.bar}>
      <div style={s.scroll}>
        {tabs.map(tab => {
          const active = tab.id === activeTab
          return (
            <div
              key={tab.id}
              style={{ ...s.tab, ...(active ? s.tabActive : {}) }}
              onPointerDown={() => handlePressStart(tab)}
              onPointerUp={() => { handlePressEnd(); if (editingId !== tab.id) onSwitch(tab.id) }}
              onPointerLeave={handlePressEnd}
            >
              {editingId === tab.id ? (
                <input
                  style={s.renameInput}
                  value={editValue}
                  autoFocus
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => handleRenameSubmit(tab.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameSubmit(tab.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span style={{ ...s.tabName, ...(active ? s.tabNameActive : {}) }}>
                  {tab.name}
                </span>
              )}
              {tabs.length > 1 && (
                <span
                  style={{ ...s.close, ...(active ? s.closeActive : {}) }}
                  onPointerDown={e => { e.stopPropagation(); onClose(tab.id) }}
                >×</span>
              )}
            </div>
          )
        })}

        <button style={s.newBtn} onPointerDown={e => { e.preventDefault(); onNew() }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#00ff00" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
      </div>
    </div>
  )
}

const s = {
  bar: {
    height: 38,
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    overflow: 'hidden',
  },
  scroll: {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    gap: 3,
    padding: '0 8px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
    userSelect: 'none',
    transition: 'background 0.15s',
  },
  tabActive: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
  },
  tabName: {
    color: 'var(--grey)',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    fontWeight: 500,
    maxWidth: 100,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  tabNameActive: {
    color: 'var(--white75)',
  },
  close: {
    color: 'var(--grey-dk)',
    fontSize: 14,
    lineHeight: 1,
    padding: '0 2px',
    cursor: 'pointer',
  },
  closeActive: {
    color: 'var(--grey)',
  },
  newBtn: {
    height: 26,
    width: 30,
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  renameInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--green)',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    width: 80,
    padding: 0,
  },
}
