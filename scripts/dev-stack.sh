#!/usr/bin/env bash
# Local Supabase-equivalent stack for development and e2e tests — NEVER staging or production.
#   Postgres 16  +  Supabase Auth (GoTrue, real sign-in)  +  PostgREST  +  a tiny gateway on :54321
# Usage: scripts/dev-stack.sh up | down | reset | status | env
# Everything lives in .local/ (gitignored). Secrets are generated per machine, dev-only, never committed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"; BIN="$LOCAL/bin"; DATA="$LOCAL/pgdata"; RUN="$LOCAL/run"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PGPORT=54322; AUTH_PORT=9999; REST_PORT=3001; GATEWAY_PORT=54321

PGRST_VERSION=v12.2.3
PGRST_SHA256=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c
AUTH_VERSION=v2.178.0
AUTH_SHA256=a5cd450518e84f588bf88ffe737d98080e4e07288826f1b57025f8fb57722c66

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # initdb/postgres refuse to run as root.
  id -u pgtest >/dev/null 2>&1 || useradd -M -s /bin/false pgtest
  RUN_AS=(runuser -u pgtest --)
fi

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -h "$RUN" -p "$PGPORT" -U postgres "$@"; }

fetch() { # url sha256 dest
  local tmp; tmp="$(mktemp)"
  curl -fsSL "$1" -o "$tmp"
  echo "$2  $tmp" | sha256sum -c --quiet - || { echo "checksum mismatch for $1" >&2; exit 1; }
  mv "$tmp" "$3"
}

install_binaries() {
  mkdir -p "$BIN"
  if [ ! -x "$BIN/postgrest" ]; then
    echo "download PostgREST $PGRST_VERSION"
    fetch "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x64.tar.xz" "$PGRST_SHA256" "$LOCAL/postgrest.tar.xz"
    tar xJf "$LOCAL/postgrest.tar.xz" -C "$BIN"
  fi
  if [ ! -x "$BIN/auth/auth" ]; then
    echo "download Supabase Auth $AUTH_VERSION"
    fetch "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" "$AUTH_SHA256" "$LOCAL/auth.tgz"
    mkdir -p "$BIN/auth" && tar xzf "$LOCAL/auth.tgz" -C "$BIN/auth"
  fi
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
sign_jwt() { # role secret
  local header payload sig
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"iss":"local-dev","role":"%s","iat":1700000000,"exp":2000000000}' "$1" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

secrets() {
  mkdir -p "$LOCAL"
  if [ ! -f "$LOCAL/secrets.env" ]; then
    local jwt; jwt=$(openssl rand -hex 32)
    {
      echo "JWT_SECRET=$jwt"
      echo "AUTHENTICATOR_PASSWORD=$(openssl rand -hex 16)"
      echo "AUTH_ADMIN_PASSWORD=$(openssl rand -hex 16)"
      echo "ANON_KEY=$(sign_jwt anon "$jwt")"
      echo "SERVICE_ROLE_KEY=$(sign_jwt service_role "$jwt")"
    } > "$LOCAL/secrets.env"
    chmod 600 "$LOCAL/secrets.env"
  fi
  # shellcheck disable=SC1091
  source "$LOCAL/secrets.env"
}

FRESH=0
start_pg() {
  mkdir -p "$RUN"
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"
    [ ${#RUN_AS[@]} -gt 0 ] && chown pgtest "$DATA" "$RUN"
    "${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
    FRESH=1
  fi
  if ! "$PGBIN/pg_isready" -h "$RUN" -p "$PGPORT" -q; then
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-k $RUN -p $PGPORT -c listen_addresses=127.0.0.1" -l "$RUN/postgres.log" -w start >/dev/null 9>&-
  fi
}

bootstrap_db() {
  [ "$FRESH" = 1 ] || return 0
  echo "bootstrap database"
  psql_admin -d postgres <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '$AUTHENTICATOR_PASSWORD';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole password '$AUTH_ADMIN_PASSWORD';
create database agri owner postgres;
SQL
  psql_admin -d agri <<SQL
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now());
SQL
}

auth_env() {
  export GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1"
  export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:$AUTH_ADMIN_PASSWORD@127.0.0.1:$PGPORT/agri?search_path=auth"
  export GOTRUE_SITE_URL="http://127.0.0.1:5173" GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=warn
  export GOTRUE_DB_MIGRATIONS_PATH="$BIN/auth/migrations"
}

migrate() {
  auth_env
  (cd "$BIN/auth" && ./auth migrate >"$RUN/auth-migrate.log" 2>&1) || { cat "$RUN/auth-migrate.log"; exit 1; }
  for f in "$ROOT"/supabase/migrations/*.sql; do
    local v; v=$(basename "$f" .sql)
    if [ -z "$(psql_admin -d agri -tAc "select 1 from supabase_migrations.schema_migrations where version = '$v'")" ]; then
      echo "migrate: $v"
      psql_admin -d agri -o /dev/null -f "$f"
      psql_admin -d agri -c "insert into supabase_migrations.schema_migrations (version) values ('$v')"
    fi
  done
  psql_admin -d agri -o /dev/null -f "$ROOT/supabase/seed/seed.sql"
  psql_admin -d agri -o /dev/null -f "$ROOT/supabase/seed/demo.sql"
}

up_service() { # name healthcheck-url command...
  local name=$1 url=$2; shift 2
  if ! curl -fs -o /dev/null "$url" -H "apikey: $ANON_KEY"; then
    # 9>&- : long-running services must not inherit (and so hold) the stack lock.
    nohup "$@" >"$RUN/$name.log" 2>&1 9>&- &
    echo $! > "$RUN/$name.pid"
  fi
}

start_services() {
  auth_env
  up_service auth "http://127.0.0.1:$AUTH_PORT/health" bash -c "cd '$BIN/auth' && exec ./auth serve"
  PGRST_DB_URI="postgres://authenticator:$AUTHENTICATOR_PASSWORD@127.0.0.1:$PGPORT/agri" \
  PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=$REST_PORT \
  PGRST_SERVER_HOST=127.0.0.1 \
    up_service postgrest "http://127.0.0.1:$REST_PORT/" "$BIN/postgrest"
  GATEWAY_PORT=$GATEWAY_PORT AUTH_PORT=$AUTH_PORT REST_PORT=$REST_PORT \
    up_service gateway "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health" node "$ROOT/scripts/local-proxy.mjs"
  for _ in $(seq 1 80); do
    if curl -fs -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health" \
       && curl -fs -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY"; then
      psql_admin -d agri -c "notify pgrst, 'reload schema'" >/dev/null
      return 0
    fi
    sleep 0.5
  done
  echo "services did not become healthy; see $RUN/*.log" >&2
  exit 1
}

demo_users() {
  # Demo farm users only (separate farm flagged is_demo), created through the real Auth admin API.
  node "$ROOT/scripts/demo-users.mjs" "http://127.0.0.1:$GATEWAY_PORT" "$SERVICE_ROLE_KEY" > "$RUN/demo-users.sql"
  psql_admin -d agri -o /dev/null -f "$RUN/demo-users.sql"
  psql_admin -d agri -o /dev/null -f "$ROOT/supabase/seed/demo_tasks.sql"
}

write_env() {
  if [ ! -f "$ROOT/.env.local" ]; then
    printf 'VITE_SUPABASE_URL=http://127.0.0.1:%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$GATEWAY_PORT" "$ANON_KEY" > "$ROOT/.env.local"
  fi
}

stop() {
  for s in gateway postgrest auth; do
    if [ -f "$RUN/$s.pid" ]; then
      kill "$(cat "$RUN/$s.pid")" 2>/dev/null || true
      rm -f "${RUN:?}/${s:?}.pid"
    fi
  done
  if [ -d "$DATA" ]; then
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
  fi
}

# One stack operation at a time (parallel callers would race on secrets, initdb and seeds).
mkdir -p "$LOCAL"
exec 9>"$LOCAL/.lock"
flock 9

case "${1:-up}" in
  up) install_binaries; secrets; start_pg; bootstrap_db; migrate; start_services; demo_users; write_env
      echo "ready: http://127.0.0.1:$GATEWAY_PORT  (demo farm users: scripts/demo-users.mjs)";;
  down) stop;;
  reset) stop; rm -rf "${DATA:?}" "${RUN:?}"; echo "local database removed";;
  status) for p in $AUTH_PORT $REST_PORT $GATEWAY_PORT; do
            if curl -fs -o /dev/null "http://127.0.0.1:$p/"; then echo "$p up"; else echo "$p down"; fi; done;;
  env) secrets; printf 'VITE_SUPABASE_URL=http://127.0.0.1:%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$GATEWAY_PORT" "$ANON_KEY";;
  *) echo "usage: $0 up|down|reset|status|env" >&2; exit 2;;
esac
