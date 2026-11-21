#!/usr/bin/env bash
# Hosted instance entrypoint (Docker): prepare the database, then run PostgREST (private, 127.0.0.1) and the packhouse server
# (public port, behind the host's HTTPS). Configuration comes from environment variables set in the hosting dashboard:
#   DATABASE_URL                 owner connection to the permanent PostgreSQL (required)
#   PH_JWT_SECRET                32+ characters, signs session tokens (required)
#   PH_AUTHENTICATOR_PASSWORD    password given to the PostgREST role (required)
#   PH_SERVER_DB_PASSWORD        password given to the server's own role (required)
#   PH_OWNER_SETUP_CODE          one-time code for the Owner's first sign-in (until the Owner activates)
#   PH_DEMO=1 / PH_DEMO_PASSWORD staging only: load the invented DEMO farm
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL is required}" "${PH_JWT_SECRET:?PH_JWT_SECRET is required}"
: "${PH_AUTHENTICATOR_PASSWORD:?required}" "${PH_SERVER_DB_PASSWORD:?required}"

# Accept a managed-database URL as its dashboard shows it: a pooled Neon host is switched to its direct host (PostgREST
# listens for schema reloads, which a transaction pooler cannot carry) and libpq-only parameters the Node driver does not
# understand are dropped.
DATABASE_URL=$(node -e '
  const u = new URL(process.env.DATABASE_URL);
  u.hostname = u.hostname.replace(/-pooler\./, ".");
  u.searchParams.delete("channel_binding");
  process.stdout.write(u.toString());')
export DATABASE_URL

node deploy/migrate.mjs

# Connection strings for the two runtime roles: same host and database, their own user and password.
role_url() { node -e '
  const u = new URL(process.env.DATABASE_URL); u.username = process.argv[1]; u.password = process.argv[2];
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", process.argv[3]);
  process.stdout.write(u.toString());' "$1" "$2" "$(cat "${TMPDIR:-/tmp}/ph-sslmode" 2>/dev/null || echo require)"; }
REST_DB_URL=$(role_url authenticator "$PH_AUTHENTICATOR_PASSWORD")
export PH_DB_URL=$(role_url po_server "$PH_SERVER_DB_PASSWORD")
export PH_DUMP_URL="$DATABASE_URL"

RUN=$(mktemp -d)
umask 077
cat > "$RUN/postgrest.conf" <<CONF
db-uri = "$REST_DB_URL"
db-schemas = "public"
db-anon-role = "anon"
db-pre-request = "app.po_pre_request"
db-pool = 5
db-prepared-statements = false
jwt-secret = "$PH_JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3001
CONF

postgrest "$RUN/postgrest.conf" &
REST_PID=$!
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ || true)" != "000" ] && break; sleep 1; done

export PH_HTTP_HOST=0.0.0.0 PH_HTTP_PORT="${PORT:-8080}" PH_REST_URL=http://127.0.0.1:3001 PH_STATIC="${PH_STATIC:-/app/dist}"
export PH_TRUST_PROXY="${PH_TRUST_PROXY:-1}" PH_BEHIND_TLS="${PH_BEHIND_TLS:-1}" PH_BACKUP_DIR=""
node server/packhouse-server.mjs &
SRV_PID=$!
trap 'kill $SRV_PID $REST_PID 2>/dev/null' TERM INT
wait -n $SRV_PID $REST_PID
kill $SRV_PID $REST_PID 2>/dev/null || true
exit 1
