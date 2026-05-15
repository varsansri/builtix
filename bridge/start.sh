#!/data/data/com.termux/files/usr/bin/bash
# Builtix Bridge — run this in Termux to connect your phone to Builtix

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BUILTIX BRIDGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check node
if ! command -v node &> /dev/null; then
  echo "Installing Node.js..."
  pkg install -y nodejs
fi

# Check claude
if ! command -v claude &> /dev/null; then
  echo ""
  echo "✗ Claude Code CLI not found."
  echo "  Install it first:"
  echo "  npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "  Then login:"
  echo "  claude"
  echo ""
  exit 1
fi

echo "✓ Node.js: $(node --version)"
echo "✓ Claude Code: $(claude --version 2>/dev/null || echo 'found')"
echo ""

# Get local IP
IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}')
PORT=${PORT:-3001}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Open Builtix → tap 🔌 LOCAL → enter:"
echo ""
echo "  http://localhost:${PORT}"
echo ""
echo "  (or from another device on same WiFi)"
echo "  http://${IP}:${PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Go to bridge folder and start
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
node server.js
