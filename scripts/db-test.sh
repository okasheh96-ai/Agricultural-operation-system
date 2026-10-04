#!/usr/bin/env bash
# Runs every migration + the structure seed on a throwaway local Postgres, then the pgTAP suite.
# Never connects to staging or production. Requires PostgreSQL 16 binaries and pgTAP (pg_prove).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PORT="${DB_TEST_PORT:-54329}"
WORK="$(mktemp -d)"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=agri_test

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # initdb refuses to run as root.
  id -u pgtest >/dev/null 2>&1 || useradd -M -s /bin/false pgtest
  chown -R pgtest "$WORK"
  RUN_AS=(runuser -u pgtest --)
fi

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
createdb agri_test

PSQL=(psql -X -q -o /dev/null -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/supabase/tests/_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "seed: seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/_helpers.sql"

if [ $# -gt 0 ]; then pg_prove --ext .sql "$@"; else pg_prove --ext .sql -r "$ROOT/supabase/tests/pgtap"; fi
