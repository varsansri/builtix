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
    <div style={styles.bar}>
      <div style={styles.scroll}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{ ...styles.tab, ...(tab.id === activeTab ? styles.tabActive : {}) }}
            onPointerDown={() => handlePressStart(tab)}
            onPointerUp={() => { handlePressEnd(); if (editingId !== tab.id) onSwitch(tab.id) }}
            onPointerLeave={handlePressEnd}
          >
            {editingId === tab.id ? (
              <input
                style={styles.renameInput}
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
              <span style={styles.tabName}>{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <span
                style={styles.close}
                onPointerDown={e => { e.stopPropagation(); onClose(tab.id) }}
              >×</span>
            )}
          </div>
        ))}
        <button style={styles.newBtn} onPointerDown={e => { e.preventDefault(); onNew() }}>
          +
        </button>
      </div>
    </div>
  )
}

const styles = {
  bar: {
    height: 34,
    background: '#050505',
    borderBottom: '1px solid #151515',
    flexShrink: 0,
    overflow: 'hidden',
  },
  scroll: {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    gap: 2,
    padding: '0 6px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: 24,
    padding: '0 8px',
    borderRadius: 3,
    border: '1px solid #1a1a1a',
    background: '#0a0a0a',
    cursor: 'pointer',
    flexShrink: 0,
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  tabActive: {
    border: '1px solid #00ff41',
    background: '#001a00',
  },
  tabName: {
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 11,
    maxWidth: 90,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  close: {
    color: '#444',
    fontSize: 14,
    lineHeight: 1,
    padding: '0 2px',
    cursor: 'pointer',
  },
  newBtn: {
    height: 24,
    width: 28,
    background: 'transparent',
    border: '1px solid #222',
    borderRadius: 3,
    color: '#00ff41',
    fontFamily: 'monospace',
    fontSize: 16,
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  renameInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#00ff41',
    fontFamily: 'monospace',
    fontSize: 11,
    width: 80,
    padding: 0,
  },
}
