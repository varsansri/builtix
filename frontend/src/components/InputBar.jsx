import React, { forwardRef } from 'react'

const InputBar = forwardRef(function InputBar({ value, onChange, onSubmit, disabled, voicePreview }, ref) {
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div style={styles.container}>
      <span style={styles.prompt}>{'>'}</span>
      <input
        ref={ref}
        style={{ ...styles.input, ...(disabled ? styles.inputDisabled : {}) }}
        value={voicePreview || value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={disabled ? 'AI is running...' : 'type command or message...'}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        style={{ ...styles.send, ...(disabled ? styles.sendDisabled : {}) }}
        onClick={onSubmit}
        disabled={disabled}
      >
        ↵
      </button>
    </div>
  )
})

export default InputBar

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    background: '#080808',
    borderTop: '1px solid #151515',
    padding: '6px 10px',
    gap: 8,
    flexShrink: 0,
  },
  prompt: {
    color: '#00ff41',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    fontSize: 13,
    caretColor: '#00ff41',
  },
  inputDisabled: { color: '#333' },
  send: {
    width: 30,
    height: 30,
    background: 'transparent',
    border: '1px solid #00ff41',
    borderRadius: 3,
    color: '#00ff41',
    fontFamily: 'monospace',
    fontSize: 14,
    cursor: 'pointer',
    flexShrink: 0,
  },
  sendDisabled: {
    border: '1px solid #222',
    color: '#333',
    cursor: 'default',
  },
}
