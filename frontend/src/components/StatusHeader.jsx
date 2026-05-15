import React from 'react'

export default function StatusHeader({ project, isRunning }) {
  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <span style={styles.logo}>⬛ BUILTIX</span>
      </div>
      <div style={styles.right}>
        <span style={styles.project}>{project}</span>
        <span style={{ ...styles.dot, background: isRunning ? '#00ff41' : '#333' }} />
        <span style={{ ...styles.status, color: isRunning ? '#00ff41' : '#444' }}>
          {isRunning ? 'RUNNING' : 'IDLE'}
        </span>
      </div>
    </div>
  )
}

const styles = {
  bar: {
    height: 44,
    background: '#080808',
    borderBottom: '1px solid #151515',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    flexShrink: 0,
  },
  left: { display: 'flex', alignItems: 'center', gap: 8 },
  logo: {
    color: '#00ff41',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 3,
  },
  right: { display: 'flex', alignItems: 'center', gap: 6 },
  project: { color: '#333', fontFamily: 'monospace', fontSize: 10 },
  dot: { width: 6, height: 6, borderRadius: '50%' },
  status: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1 },
}
