#!/data/data/com.termux/files/usr/bin/bash
# Builtrix Bridge — run this in Termux to power the website for everyone

BRIDGE_TOKEN="${BRIDGE_TOKEN:-builtrix-bridge}"
REGISTRY="https://builtix.vercel.app/api/bridge-url"
PORT="${PORT:-3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BUILTRIX BRIDGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check node
if ! command -v node &>/dev/null; then pkg install -y nodejs; fi

# Check cloudflared
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  pkg install -y cloudflared 2>/dev/null || \
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
    -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
fi

# Kill any old instances
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

echo ""
echo "Starting bridge server..."
cd "$SCRIPT_DIR"
node server.js > /tmp/builtrix-bridge.log 2>&1 &
BRIDGE_PID=$!
echo "Bridge PID: $BRIDGE_PID"
sleep 2

echo "Starting cloudflared tunnel..."
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate \
  > /tmp/builtrix-tunnel.log 2>&1 &
TUNNEL_PID=$!

echo "Waiting for tunnel URL..."
PUBLIC_URL=""
for i in $(seq 1 30); do
  sleep 2
  # cloudflared prints the URL to stderr/stdout in different formats
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/builtrix-tunnel.log 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    PUBLIC_URL="$URL"
    break
  fi
done

if [ -z "$PUBLIC_URL" ]; then
  echo "✗ Could not get tunnel URL. Check /tmp/builtrix-tunnel.log"
  cat /tmp/builtrix-tunnel.log | tail -20
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Tunnel: $PUBLIC_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Register URL with Vercel so everyone gets it
echo "Registering with builtix.vercel.app..."
RESULT=$(curl -s -X POST "$REGISTRY" \
  -H "Content-Type: application/json" \
  -H "x-bridge-token: $BRIDGE_TOKEN" \
  -d "{\"url\": \"$PUBLIC_URL\"}")

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "✓ Registered — everyone who opens Builtrix"
  echo "  will now connect through your phone!"
else
  echo "⚠ Could not register: $RESULT"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Keep this terminal open."
echo "  Press Ctrl+C to stop."
echo ""

# Keep alive and show bridge logs
tail -f /tmp/builtrix-bridge.log &

# Auto-update: poll GitHub every 5 min, restart bridge if server.js changed
(
  LAST_SHA=$(git rev-parse HEAD 2>/dev/null)
  while true; do
    sleep 300
    git fetch origin main -q 2>/dev/null
    NEW_SHA=$(git rev-parse origin/main 2>/dev/null)
    if [ "$NEW_SHA" != "$LAST_SHA" ]; then
      echo "[auto-update] New version detected — pulling and restarting..."
      git reset --hard origin/main -q
      LAST_SHA=$NEW_SHA
      kill $BRIDGE_PID 2>/dev/null
      sleep 1
      node server.js > /tmp/builtrix-bridge.log 2>&1 &
      BRIDGE_PID=$!
      echo "[auto-update] ✓ Bridge restarted (PID $BRIDGE_PID)"
    fi
  done
) &

wait $BRIDGE_PID
