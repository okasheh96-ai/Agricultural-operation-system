#!/usr/bin/env bash
# Hands-on testing of the current build in GitHub Codespaces (or anywhere the browser reaches only one forwarded port).
# Local stack and demo farm only — NEVER staging or production. Usage: npm run codespaces
#   1. starts the local stack if it is not running (existing local data is kept)
#   2. stops earlier dev/preview servers of this checkout, so no stale server answers on another port
#   3. builds the app with its own forwarded address as the API URL; the preview server passes /auth/v1 and /rest/v1
#      to the local gateway (vite.config.ts), so the browser makes no cross-origin call and port 54321 stays private
#   4. serves it on 4173 and signs in once through that address to prove it works
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT=4173
OUT="$ROOT/.local/codespaces-dist"
LOG="$ROOT/.local/codespaces-preview.log"

if [ -z "${APP_URL:-}" ]; then
  if [ -n "${CODESPACE_NAME:-}" ]; then
    APP_URL="https://$CODESPACE_NAME-$PORT.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    APP_URL="http://localhost:$PORT"
  fi
fi
status() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }

if [ "$(status http://127.0.0.1:54321/auth/v1/health)" = 200 ]; then
  echo "== local stack: running"
else
  echo "== local stack: starting (existing local data is kept)"
  scripts/dev-stack.sh up | tail -1
fi
KEY="$(scripts/dev-stack.sh env | sed -n 's/^VITE_SUPABASE_ANON_KEY=//p')"

echo "== stopping earlier app servers of this checkout"
stopped=0
for pid in $(pgrep -f 'node_modules/\.bin/vite' || true); do
  if [ "$(ps -o comm= -p "$pid" 2>/dev/null)" = node ] && [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$ROOT" ]; then
    echo "   stopping: $(tr '\0' ' ' < "/proc/$pid/cmdline" | sed 's|.*node_modules/.bin/||')"
    kill "$pid" 2>/dev/null && stopped=1
  fi
done
[ "$stopped" = 1 ] || echo "   none running"
for _ in $(seq 1 20); do [ "$(status "http://localhost:$PORT/")" = 000 ] && break; sleep 0.5; done
if [ "$(status "http://localhost:$PORT/")" != 000 ]; then
  echo "port $PORT is still in use by another program; stop it and run this again" >&2; exit 1
fi

echo "== building the app for $APP_URL"
VITE_SUPABASE_URL="$APP_URL" VITE_SUPABASE_ANON_KEY="$KEY" npx vite build --outDir "$OUT" --emptyOutDir --logLevel error

echo "== serving on port $PORT"
nohup npx vite preview --outDir "$OUT" --port "$PORT" --strictPort > "$LOG" 2>&1 &
for _ in $(seq 1 60); do [ "$(status "http://localhost:$PORT/")" = 200 ] && break; sleep 0.5; done

echo "== checking"
fail() { echo "FAILED: $1" >&2; tail -20 "$LOG" >&2; exit 1; }
[ "$(status "http://localhost:$PORT/")" = 200 ] || fail "the app did not start on port $PORT"
grep -rqF "$APP_URL" "$OUT/assets" || fail "the build does not use $APP_URL"
[ "$(status -X POST "http://localhost:$PORT/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"email":"demo.supervisor@demo.local","password":"demo-password-123"}')" = 200 ] || fail "sign-in through port $PORT"
[ "$(status "http://localhost:$PORT/rest/v1/" -H "apikey: $KEY")" = 200 ] || fail "data API through port $PORT"
echo "   app, sign-in and data API all answer through port $PORT"

cat <<MSG

Ready. Open this address (close any old tabs on other ports first):
   $APP_URL
Sign in: demo.supervisor@demo.local / demo-password-123   (other demo users: README.md)
The server keeps running after this script ends. Log: .local/codespaces-preview.log. Run again any time: npm run codespaces
MSG
