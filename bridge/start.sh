#!/data/data/com.termux/files/usr/bin/bash
# Biyatrix Bridge — 3-tunnel redundancy, auto-failover, watchdog

BRIDGE_TOKEN="${BRIDGE_TOKEN:-biyatrix-bridge}"
REGISTRY="https://biyatrix.vercel.app/api/bridge-url"
PORT="${PORT:-3001}"
TUNNEL_COUNT=3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUNNEL_DIR="/tmp/biyatrix-tunnels"
BRIDGE_LOG="/tmp/biyatrix-bridge.log"

mkdir -p "$TUNNEL_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BIYATRIX BRIDGE — MULTI-TUNNEL MODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Keep CPU awake even with screen off
if command -v termux-wake-lock &>/dev/null; then
  termux-wake-lock && echo "✓ Wake lock acquired"
fi

# Check dependencies
command -v node &>/dev/null || pkg install -y nodejs
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  pkg install -y cloudflared 2>/dev/null || {
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
      -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
  }
fi

# Kill ALL old instances cleanly
pkill -9 -f "node server.js" 2>/dev/null
pkill -9 -f "cloudflared tunnel" 2>/dev/null
pkill -9 -f "tail.*biyatrix" 2>/dev/null
rm -f "$TUNNEL_DIR"/*.{log,pid,url}
sleep 2

# Start bridge server
echo "Starting bridge server..."
cd "$SCRIPT_DIR"
node server.js > "$BRIDGE_LOG" 2>&1 &
echo $! > "$TUNNEL_DIR/bridge.pid"
echo "Bridge PID: $(cat $TUNNEL_DIR/bridge.pid)"
sleep 2

# ── Helpers ──────────────────────────────────────────────────────────

start_tunnel() {
  local idx=$1
  local log="$TUNNEL_DIR/tunnel-${idx}.log"
  > "$log"
  rm -f "$TUNNEL_DIR/tunnel-${idx}.url"
  cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$log" 2>&1 &
  echo $! > "$TUNNEL_DIR/tunnel-${idx}.pid"
  echo "  Tunnel $((idx+1)) started (PID $(cat $TUNNEL_DIR/tunnel-${idx}.pid))"
  # Background URL extractor
  (
    for _ in $(seq 1 25); do
      sleep 2
      URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | head -1)
      if [ -n "$URL" ]; then
        echo "$URL" > "$TUNNEL_DIR/tunnel-${idx}.url"
        break
      fi
    done
  ) &
}

get_tunnel_url() { cat "$TUNNEL_DIR/tunnel-${1}.url" 2>/dev/null; }

tunnel_alive() {
  local pid; pid=$(cat "$TUNNEL_DIR/tunnel-${1}.pid" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

check_url_alive() {
  [ -z "$1" ] && return 1
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$1/health" 2>/dev/null)
  [ "$code" = "200" ]
}

register_url() {
  local result
  result=$(curl -s -X POST "$REGISTRY" \
    -H "Content-Type: application/json" \
    -H "x-bridge-token: $BRIDGE_TOKEN" \
    -d "{\"url\": \"$1\"}")
  echo "$result" | grep -q '"ok":true'
}

get_active_url() { cat "$TUNNEL_DIR/active.url" 2>/dev/null; }
get_active_idx() { cat "$TUNNEL_DIR/active.idx" 2>/dev/null; }

set_active() {
  local idx=$1
  get_tunnel_url "$idx" > "$TUNNEL_DIR/active.url"
  echo "$idx" > "$TUNNEL_DIR/active.idx"
}

# ── Start all 3 tunnels ──────────────────────────────────────────────

echo ""
echo "Starting $TUNNEL_COUNT tunnels..."
for i in $(seq 0 $((TUNNEL_COUNT-1))); do
  start_tunnel $i
  sleep 1
done

echo "Waiting for tunnel URLs..."
sleep 15
for i in $(seq 0 $((TUNNEL_COUNT-1))); do
  URL=$(get_tunnel_url $i)
  if [ -n "$URL" ]; then
    echo "  ✓ Tunnel $((i+1)): $URL"
  else
    echo "  ✗ Tunnel $((i+1)): no URL yet (will retry)"
  fi
done

# Register first healthy tunnel
echo ""
echo "Registering active tunnel..."
REGISTERED=false
for i in $(seq 0 $((TUNNEL_COUNT-1))); do
  URL=$(get_tunnel_url $i)
  if [ -n "$URL" ] && check_url_alive "$URL"; then
    set_active $i
    if register_url "$URL"; then
      echo "✓ Live: $URL"
      REGISTERED=true
      break
    fi
  fi
done
$REGISTERED || echo "⚠ No tunnel ready yet — watchdog will register when ready"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ ACTIVE: $(get_active_url)"
echo "  Backups: $((TUNNEL_COUNT-1)) tunnels on standby"
echo "  Watchdog checks every 20s"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Keep this terminal open. Ctrl+C to stop."
echo ""

# ── Auto-update from GitHub every 5 min ─────────────────────────────
(
  LAST_SHA=$(git rev-parse HEAD 2>/dev/null)
  while true; do
    sleep 300
    git fetch origin main -q 2>/dev/null
    NEW_SHA=$(git rev-parse origin/main 2>/dev/null)
    if [ "$NEW_SHA" != "$LAST_SHA" ]; then
      echo "[auto-update] New version — pulling..."
      git reset --hard origin/main -q
      LAST_SHA=$NEW_SHA
      BRIDGE_PID=$(cat "$TUNNEL_DIR/bridge.pid" 2>/dev/null)
      kill "$BRIDGE_PID" 2>/dev/null
      sleep 1
      cd "$SCRIPT_DIR"
      node server.js > "$BRIDGE_LOG" 2>&1 &
      echo $! > "$TUNNEL_DIR/bridge.pid"
      echo "[auto-update] ✓ Bridge restarted"
    fi
  done
) &

# ── Watchdog loop ────────────────────────────────────────────────────
TICK=0
while true; do
  sleep 20
  TICK=$((TICK+1))

  # Restart bridge if it died
  BRIDGE_PID=$(cat "$TUNNEL_DIR/bridge.pid" 2>/dev/null)
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "[watchdog] Bridge died — restarting..."
    cd "$SCRIPT_DIR"
    node server.js > "$BRIDGE_LOG" 2>&1 &
    echo $! > "$TUNNEL_DIR/bridge.pid"
    echo "[watchdog] ✓ Bridge restarted"
    sleep 3
  fi

  ACTIVE_IDX=$(get_active_idx)
  ACTIVE_URL=$(get_active_url)

  if check_url_alive "$ACTIVE_URL"; then
    # Heartbeat re-register every 10 min (30 × 20s)
    if [ $((TICK % 30)) -eq 0 ]; then
      register_url "$ACTIVE_URL" >/dev/null 2>&1
      echo "[heartbeat] ✓ Re-registered tunnel $((ACTIVE_IDX+1))"
    fi
    # Keep backups healthy — replace any dead ones
    for i in $(seq 0 $((TUNNEL_COUNT-1))); do
      [ "$i" = "$ACTIVE_IDX" ] && continue
      if ! tunnel_alive $i; then
        echo "[watchdog] Backup $((i+1)) dead — replacing silently..."
        start_tunnel $i
      fi
    done
    continue
  fi

  # ── Active tunnel is dead — failover instantly ───────────────────
  echo "[watchdog] ⚠ Active tunnel offline — failing over..."
  SWITCHED=false
  for i in $(seq 0 $((TUNNEL_COUNT-1))); do
    [ "$i" = "$ACTIVE_IDX" ] && continue
    URL=$(get_tunnel_url $i)
    if [ -n "$URL" ] && tunnel_alive $i && check_url_alive "$URL"; then
      OLD_IDX=$ACTIVE_IDX
      set_active $i
      if register_url "$URL"; then
        echo "[watchdog] ✓ Switched → tunnel $((i+1)): $URL"
      fi
      SWITCHED=true
      # Replace the dead tunnel
      kill "$(cat $TUNNEL_DIR/tunnel-${OLD_IDX}.pid 2>/dev/null)" 2>/dev/null
      start_tunnel "$OLD_IDX"
      echo "[watchdog] Rebuilding tunnel $((OLD_IDX+1)) in background..."
      break
    fi
  done

  # All tunnels dead — full restart
  if ! $SWITCHED; then
    echo "[watchdog] ✗ All tunnels dead — full restart..."
    for i in $(seq 0 $((TUNNEL_COUNT-1))); do
      kill "$(cat $TUNNEL_DIR/tunnel-${i}.pid 2>/dev/null)" 2>/dev/null
      sleep 0.5
      start_tunnel $i
    done
    sleep 20
    for i in $(seq 0 $((TUNNEL_COUNT-1))); do
      URL=$(get_tunnel_url $i)
      if [ -n "$URL" ] && check_url_alive "$URL"; then
        set_active $i
        register_url "$URL" && echo "[watchdog] ✓ Recovered: $URL"
        break
      fi
    done
  fi
done
