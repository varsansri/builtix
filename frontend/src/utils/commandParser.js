export const COMMANDS = {
  '/start':   'Begin a new AI project or session',
  '/run':     'Send current input to AI and execute',
  '/stop':    'Halt the running AI process',
  '/clear':   'Clear the terminal screen',
  '/new':     'Start a fresh project session',
  '/history': 'Show command history',
  '/why':     'Show AI decision log for last task',
  '/help':    'Show all commands',
}

export function parseCommand(input) {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return { type: 'message', value: trimmed }
  const [cmd, ...args] = trimmed.split(' ')
  const command = cmd.toLowerCase()
  if (COMMANDS[command]) return { type: 'command', command, args: args.join(' ') }
  return { type: 'unknown', value: trimmed }
}

export function getHelpText() {
  return [
    '────────────────────────────────',
    '  BUILTIX — Available Commands',
    '────────────────────────────────',
    ...Object.entries(COMMANDS).map(([cmd, desc]) =>
      `  ${cmd.padEnd(12)} ${desc}`
    ),
    '────────────────────────────────',
    '  Voice: tap the mic button',
    '  Files: tap the attach button',
    '  CTRL+C to stop any process',
    '────────────────────────────────',
  ]
}
