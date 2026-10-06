#!/usr/bin/env bash
# Hands-on testing of the current build in GitHub Codespaces (or anywhere the browser reaches only one forwarded port).
# Local stack and demo farm only — NEVER staging or production.
# Usage: npm run codespaces            start (or restart) and print the address
#        npm run codespaces -- stop    stop the app server (e.g. before `npm run test:e2e`, which also uses port 4173)
#   1. brings the local stack up to date: starts what is not running, applies new migrations (local data is kept)
#   2. stops earlier dev servers and the previous run of this script in this checkout, so no stale server answers
#   3. builds the app (demo build: one-tap sign-in for the demo farm) with its own forwarded address as the API URL; the preview server passes /auth/v1 and /rest/v1
#      to the local gateway (vite.config.ts), so the browser makes no cross-origin call and every port can stay private
#   4. serves it on 4173 and signs in once through that address to prove it works
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
PORT=4173
OUT="$ROOT/.local/codespaces-dist"
LOG="$ROOT/.local/codespaces-preview.log"

status() { curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$@" || true; }

stop_app_servers() {
  # Only Vite dev servers (`vite`, `vite --config …`) and this script's own preview, run from this checkout. Test runners
  # (vitest, Playwright's preview servers) and builds are left alone.
  local stopped=0 pid cmd
  for pid in $(pgrep -f 'node_modules/\.bin/vite' || true); do
    [ "$(ps -o comm= -p "$pid" 2>/dev/null)" = node ] || continue
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$ROOT" ] || continue
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | sed 's|.*node_modules/.bin/||')"
    if [[ "$cmd" =~ ^vite\ *$ || "$cmd" =~ ^vite\ +-- || "$cmd" == *codespaces-dist* ]]; then
      echo "   stopping: $cmd"
      kill -TERM "$pid" 2>/dev/null && kill -CONT "$pid" 2>/dev/null  # CONT: a suspended (Ctrl+Z) server must still exit
      stopped=1
    fi
  done
  [ "$stopped" = 1 ] || echo "   none running"
}

if [ "${1:-}" = stop ]; then
  echo "== stopping the app server"; stop_app_servers; exit 0
fi

if [ -z "${APP_URL:-}" ]; then
  if [ -n "${CODESPACE_NAME:-}" ]; then
    APP_URL="https://$CODESPACE_NAME-$PORT.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    APP_URL="http://localhost:$PORT"
  fi
fi
APP_HOST="$(printf '%s' "$APP_URL" | sed -E 's|^[a-z]+://||; s|/.*$||')"

echo "== local stack: bringing it up to date (local data is kept)"
scripts/dev-stack.sh up | tail -1
KEY="$(scripts/dev-stack.sh env | sed -n 's/^VITE_SUPABASE_ANON_KEY=//p')"

echo "== stopping earlier app servers of this checkout"
stop_app_servers
for _ in $(seq 1 20); do [ "$(status "http://localhost:$PORT/")" = 000 ] && break; sleep 0.5; done
if [ "$(status "http://localhost:$PORT/")" != 000 ]; then
  echo "port $PORT is still in use (a Playwright test run or another program); stop it and run this again" >&2; exit 1
fi

echo "== building the app for $APP_URL"
PWA_NETWORK_SHELL=1 VITE_DEMO_SIGNIN=1 VITE_SUPABASE_URL="$APP_URL" VITE_SUPABASE_ANON_KEY="$KEY" \
  npx vite build --outDir "$OUT" --emptyOutDir > "$ROOT/.local/codespaces-build.log" 2>&1 \
  || { tail -30 "$ROOT/.local/codespaces-build.log" >&2; echo "FAILED: build (log: .local/codespaces-build.log)" >&2; exit 1; }

echo "== serving on port $PORT"
nohup npx vite preview --outDir "$OUT" --port "$PORT" --strictPort > "$LOG" 2>&1 &
for _ in $(seq 1 60); do [ "$(status "http://localhost:$PORT/")" = 200 ] && break; sleep 0.5; done

echo "== checking"
fail() { echo "FAILED: $1" >&2; tail -20 "$LOG" >&2; exit 1; }
[ "$(status "http://localhost:$PORT/")" = 200 ] || fail "the app did not start on port $PORT"
[ "$(status -H "Host: $APP_HOST" "http://localhost:$PORT/")" = 200 ] || fail "the app refuses requests addressed to $APP_HOST"
grep -rqF "$APP_URL" "$OUT/assets" || fail "the build does not use $APP_URL"
[ "$(status -X POST "http://localhost:$PORT/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"email":"demo.supervisor@demo.local","password":"demo-password-123"}')" = 200 ] || fail "sign-in through port $PORT"
[ "$(status "http://localhost:$PORT/rest/v1/" -H "apikey: $KEY")" = 200 ] || fail "data API through port $PORT"
echo "   app, sign-in and data API all answer through port $PORT"

cat <<MSG

Ready. Open this address:
   $APP_URL
Sign in: tap a role under "Quick sign-in" (System admin = every department), or demo.*@demo.local / demo-password-123
- If a page or sign-in fails after a break, reload the page once (Codespaces asks you to log in again every 3 hours).
- The server keeps running after this script ends, until the Codespace stops (it stops when idle). Then open the
  Codespace again and run: npm run codespaces
- Stop it with: npm run codespaces -- stop   (needed before npm run test:e2e, which also uses port $PORT)
MSG
