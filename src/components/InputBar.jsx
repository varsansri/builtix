import React, { forwardRef } from 'react'

const InputBar = forwardRef(function InputBar({ value, onChange, onSubmit, disabled, voicePreview }, ref) {
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div style={s.container}>
      <span style={s.prompt}>{'>'}</span>
      <input
        ref={ref}
        style={{ ...s.input, ...(disabled ? s.inputDisabled : {}) }}
        value={voicePreview || value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={disabled ? 'Builtix is thinking…' : 'type a command or task…'}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        style={{ ...s.send, ...(disabled ? s.sendDisabled : {}) }}
        onClick={onSubmit}
        disabled={disabled}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
          stroke={disabled ? 'rgba(255,255,255,0.15)' : '#00ff00'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="13 3 8 8 3 3" />
          <line x1="8" y1="8" x2="8" y2="14" />
        </svg>
      </button>
    </div>
  )
})

export default InputBar

const s = {
  container: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    padding: '8px 12px',
    gap: 10,
    flexShrink: 0,
  },
  prompt: {
    color: 'var(--green)',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 15,
    fontWeight: 700,
    flexShrink: 0,
    lineHeight: 1,
  },
  input: {
    flex: 1,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    outline: 'none',
    color: 'var(--white75)',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    caretColor: 'var(--green)',
    padding: '7px 12px',
    transition: 'border-color 0.15s',
  },
  inputDisabled: {
    color: 'var(--grey)',
    cursor: 'not-allowed',
  },
  send: {
    width: 34,
    height: 34,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'border-color 0.15s',
  },
  sendDisabled: {
    cursor: 'default',
  },
}
