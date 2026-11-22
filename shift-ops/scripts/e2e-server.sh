#!/usr/bin/env bash
# Fresh, isolated local D1 + R2 state for every e2e run; dev auth is enabled only through CLI vars here.
set -euo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false
STATE=.wrangler/e2e
rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" >/dev/null
npx wrangler d1 migrations apply RESTORE_DB --local --persist-to "$STATE" >/dev/null
exec npx wrangler dev --port 8788 --persist-to "$STATE" --var AUTH_MODE:dev --var OWNER_EMAIL:owner@example.test --show-interactive-dev-session=false
