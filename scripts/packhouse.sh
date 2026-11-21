#!/usr/bin/env bash
# Packhouse instance launcher (Linux and macOS). Runs PostgreSQL 16 + PostgREST + the packhouse server on this computer only.
#
#   scripts/packhouse.sh install [--demo]   first-time setup: database, migrations, structure, Owner one-time code, app build
#   scripts/packhouse.sh start [--no-browser] | stop | restart | status | url
#   scripts/packhouse.sh backup             write a backup now (also automatic every PH_BACKUP_HOURS, default 6)
#   scripts/packhouse.sh restore FILE       replace the database with a backup (asks for confirmation; keeps a safety copy)
#   scripts/packhouse.sh lan on|off         serve staff devices over HTTPS on the private network (local certificate)
#   scripts/packhouse.sh owner-code         show where the Owner's one-time code is
#
# Data lives in PH_HOME (default ~/PackhouseData): database, backups, certificates, private config (mode 600).
# --demo installs the separate DEMO farm with invented data for trying and testing; never use it for real work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PH_HOME="${PH_HOME:-$HOME/PackhouseData}"
CFG="$PH_HOME/config.json"; RUN="$PH_HOME/run"; DATA="$PH_HOME/pgdata"; BIN="$PH_HOME/bin"
PG_PORT="${PH_PG_PORT:-54330}"; REST_PORT="${PH_REST_PORT:-3011}"; HTTP_PORT="${PH_HTTP_PORT:-8080}"; HTTPS_PORT="${PH_HTTPS_PORT:-8443}"
DB=packhouse
OS="$(uname -s)"; ARCH="$(uname -m)"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------------------------
find_pgbin() {
  local c
  for c in "${PH_PGBIN:-}" "$(pg_config --bindir 2>/dev/null || true)" /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@16/bin /Applications/Postgres.app/Contents/Versions/16/bin; do
    if [ -n "$c" ] && [ -x "$c/initdb" ] && "$c/postgres" --version 2>/dev/null | grep -q ' 16\.'; then echo "$c"; return 0; fi
  done
  return 1
}

check_deps() {
  command -v node >/dev/null || die "Node.js 20 or newer is required (https://nodejs.org)."
  local nv; nv=$(node -p 'process.versions.node.split(".")[0]'); [ "$nv" -ge 20 ] || die "Node.js 20+ is required (found $nv)."
  command -v openssl >/dev/null || die "openssl is required."
  if ! PGBIN=$(find_pgbin); then
    if [ "$OS" = Darwin ] && command -v brew >/dev/null; then
      say "Installing PostgreSQL 16 with Homebrew…"; brew install postgresql@16 >/dev/null; PGBIN=$(find_pgbin) || die "PostgreSQL 16 not found after install."
    else
      die "PostgreSQL 16 is required. Linux: sudo apt-get install postgresql-16. macOS: install Homebrew (https://brew.sh), then run this again."
    fi
  fi
  export PGBIN
}

install_postgrest() {
  mkdir -p "$BIN"
  [ -x "$BIN/postgrest" ] && return 0
  if [ "$OS" = Darwin ]; then
    # The macOS release builds link Homebrew's libpq, so the Homebrew formula is the reliable route on a Mac.
    command -v brew >/dev/null || die "macOS: install Homebrew (https://brew.sh) first; PostgREST is installed from it."
    brew list postgrest >/dev/null 2>&1 || { say "Installing PostgREST with Homebrew…"; brew install postgrest >/dev/null; }
    ln -sf "$(brew --prefix)/bin/postgrest" "$BIN/postgrest"
    return 0
  fi
  local url sha
  case "$ARCH" in
    x86_64) url=https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
            sha=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c ;;
    *) die "No pinned PostgREST build for Linux $ARCH; install postgrest and set PATH, or copy it to $BIN/postgrest." ;;
  esac
  say "Downloading PostgREST (checksum verified)…"
  local tmp; tmp="$(mktemp)"
  curl -fsSL "$url" -o "$tmp"
  echo "$sha  $tmp" | (sha256sum -c --quiet - 2>/dev/null || shasum -a 256 -c --quiet -) || die "PostgREST checksum mismatch"
  tar xJf "$tmp" -C "$BIN"; rm -f "$tmp"
}

# ---------------------------------------------------------------------------------------------
# Config and PostgreSQL
# ---------------------------------------------------------------------------------------------
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  id -u pgtest >/dev/null 2>&1 || useradd -M -s /bin/false pgtest
  RUN_AS=(runuser -u pgtest --)
fi
cfg() { node -e "const c=require('$CFG'); process.stdout.write(String(c['$1'] ?? ''))"; }
psql_su() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$RUN" -p "$PG_PORT" -U postgres "$@"; }

write_config() {
  mkdir -p "$PH_HOME" "$RUN" "$PH_HOME/backups"; chmod 700 "$PH_HOME"
  [ -f "$CFG" ] && return 0
  local jwt auth srv; jwt=$(openssl rand -hex 32); auth=$(openssl rand -hex 16); srv=$(openssl rand -hex 16)
  cat > "$CFG" <<JSON
{
  "PH_JWT_SECRET": "$jwt",
  "PH_AUTHENTICATOR_PASSWORD": "$auth",
  "PH_SERVER_DB_PASSWORD": "$srv",
  "PH_DB_URL": "postgres://po_server:$srv@127.0.0.1:$PG_PORT/$DB",
  "PH_DUMP_URL": "postgresql:///$DB?host=$RUN&port=$PG_PORT&user=postgres",
  "PH_REST_URL": "http://127.0.0.1:$REST_PORT",
  "PH_HTTP_PORT": $HTTP_PORT,
  "PH_HTTPS_PORT": $HTTPS_PORT,
  "PH_STATIC": "$PH_HOME/app",
  "PH_BACKUP_DIR": "$PH_HOME/backups",
  "PH_BACKUP_HOURS": 6,
  "PH_BACKUP_KEEP": 28,
  "PH_PGBIN": "$PGBIN"
}
JSON
  chmod 600 "$CFG"
}

start_pg() {
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"
    # Running as root (containers): PostgreSQL runs as an unprivileged user that owns the private data folder.
    [ ${#RUN_AS[@]} -gt 0 ] && chown pgtest "$PH_HOME" "$DATA" "$RUN" "$PH_HOME/backups"
    "${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 -E UTF8 --locale=C >/dev/null
  fi
  if ! "$PGBIN/pg_isready" -h "$RUN" -p "$PG_PORT" -q; then
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-k $RUN -p $PG_PORT -c listen_addresses=127.0.0.1" -l "$RUN/postgres.log" -w start >/dev/null 9>&-
  fi
}

migrate() {
  psql_su -d "$DB" -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now())"
  local f v
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v=$(basename "$f" .sql)
    if [ -z "$(psql_su -d "$DB" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$v'")" ]; then
      say "  migrate $v"
      psql_su -d "$DB" -o /dev/null -f "$f"
      psql_su -d "$DB" -c "insert into supabase_migrations.schema_migrations (version) values ('$v')"
    fi
  done
  psql_su -d "$DB" -o /dev/null -f "$ROOT/supabase/seed/seed.sql"
}

bootstrap_db() {
  [ -n "$(psql_su -d postgres -tAc "select 1 from pg_database where datname = '$DB'")" ] && return 0
  say "Creating the database…"
  psql_su -d postgres <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'po_server') then create role po_server login; end if;
end \$\$;
alter role authenticator password '$(cfg PH_AUTHENTICATOR_PASSWORD)';
alter role po_server password '$(cfg PH_SERVER_DB_PASSWORD)';
grant anon, authenticated to authenticator;
create database $DB;
SQL
  psql_su -d "$DB" -o /dev/null -f "$ROOT/supabase/appliance/auth.sql"
}

write_postgrest_conf() {
  cat > "$PH_HOME/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$(cfg PH_AUTHENTICATOR_PASSWORD)@127.0.0.1:$PG_PORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-pre-request = "app.po_pre_request"
jwt-secret = "$(cfg PH_JWT_SECRET)"
server-host = "127.0.0.1"
server-port = $REST_PORT
CONF
  chmod 600 "$PH_HOME/postgrest.conf"
}

build_app() {
  say "Building the app…"
  (cd "$ROOT" && { [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null; } \
     && VITE_SUPABASE_URL=same-origin VITE_SUPABASE_ANON_KEY=packhouse-anon VITE_PACKHOUSE_SERVER=1 npx vite build --outDir "$PH_HOME/app" --emptyOutDir >/dev/null)
}

running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
start_services() {
  start_pg
  if ! running postgrest; then
    nohup "$BIN/postgrest" "$PH_HOME/postgrest.conf" >"$RUN/postgrest.log" 2>&1 9>&- &
    echo $! > "$RUN/postgrest.pid"
  fi
  if ! running server; then
    PH_CONFIG="$CFG" nohup node "$ROOT/server/packhouse-server.mjs" >"$RUN/server.log" 2>&1 9>&- &
    echo $! > "$RUN/server.pid"
  fi
  local i
  for i in $(seq 1 60); do
    if curl -fs -o /dev/null "http://127.0.0.1:$HTTP_PORT/api/health"; then return 0; fi
    sleep 0.5
  done
  say "The server did not answer; see $RUN/server.log and $RUN/postgrest.log"; tail -5 "$RUN/server.log" "$RUN/postgrest.log" >&2 || true
  exit 1
}

stop_services() {
  local s
  for s in server postgrest; do
    if running "$s"; then kill "$(cat "$RUN/$s.pid")" 2>/dev/null || true; fi
    rm -f "$RUN/$s.pid"
  done
  [ -d "$DATA" ] && "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
}

bootstrap_owner() {
  [ -f "$PH_HOME/OWNER-FIRST-SIGN-IN.txt" ] && return 0
  local farm code
  farm=$(psql_su -d "$DB" -tAc "select id from public.farms where code = 'FARM'")
  code=$(psql_su -d "$DB" -tAc "select public.po_bootstrap_owner('$farm', 'owner', 'المالك / Owner')")
  umask 077
  cat > "$PH_HOME/OWNER-FIRST-SIGN-IN.txt" <<TXT
Packhouse — Owner first sign-in (keep private; delete after use)
Address: http://127.0.0.1:$HTTP_PORT   →  "First sign-in with a code"
Username: owner
One-time code: $code
The code works once and expires in 30 days. You choose your own password with it.
TXT
  chmod 600 "$PH_HOME/OWNER-FIRST-SIGN-IN.txt"
}

load_demo() {
  say "Loading the DEMO farm (invented data, separate from the real farm)…"
  psql_su -d "$DB" -o /dev/null -f "$ROOT/supabase/seed/demo.sql"
  node "$ROOT/scripts/appliance-demo-users.mjs" > "$RUN/demo-users.sql"
  psql_su -d "$DB" -o /dev/null -f "$RUN/demo-users.sql"
  local f
  for f in demo_tasks demo_packing_house demo_packing_house_production demo_packing_house_m2 demo_packhouse_ops; do
    psql_su -d "$DB" -o /dev/null -f "$ROOT/supabase/seed/$f.sql"
  done
}

lan_certs() {
  local dir="$PH_HOME/tls" ip host
  mkdir -p "$dir"; chmod 700 "$dir"
  ip=$( (hostname -I 2>/dev/null | awk '{print $1}') || true); [ -z "$ip" ] && ip=$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)
  host=$(hostname)
  if [ ! -f "$dir/ca.crt" ]; then
    openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=Packhouse private CA" -keyout "$dir/ca.key" -out "$dir/ca.crt" >/dev/null 2>&1
  fi
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$host" -keyout "$dir/server.key" -out "$dir/server.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s,DNS:localhost,IP:%s,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' "$host" "$ip" > "$dir/ext.cnf"
  openssl x509 -req -in "$dir/server.csr" -CA "$dir/ca.crt" -CAkey "$dir/ca.key" -CAcreateserial -days 825 -extfile "$dir/ext.cnf" -out "$dir/server.crt" >/dev/null 2>&1
  chmod 600 "$dir"/*.key
  node -e "const f='$CFG',c=require(f);c.PH_TLS_CERT='$dir/server.crt';c.PH_TLS_KEY='$dir/server.key';require('fs').writeFileSync(f,JSON.stringify(c,null,2))"
  say "Staff devices: https://$ip:$HTTPS_PORT — install $dir/ca.crt on each device once so the browser trusts it."
}

open_browser() {
  local url="http://127.0.0.1:$HTTP_PORT"
  if [ "$OS" = Darwin ]; then open "$url" || true; elif command -v xdg-open >/dev/null; then xdg-open "$url" >/dev/null 2>&1 || true; fi
}

# ---------------------------------------------------------------------------------------------
mkdir -p "$PH_HOME"
exec 9>"$PH_HOME/.lock"
command -v flock >/dev/null && flock 9

cmd="${1:-start}"; shift || true
case "$cmd" in
  install)
    check_deps; install_postgrest; write_config; start_pg; bootstrap_db; say "Applying migrations…"; migrate
    write_postgrest_conf
    [ "${1:-}" = "--demo" ] && load_demo
    psql_su -d "$DB" -c "grant po_auth to po_server"
    bootstrap_owner; build_app; start_services
    say "Ready: http://127.0.0.1:$HTTP_PORT"
    say "Owner first sign-in: $PH_HOME/OWNER-FIRST-SIGN-IN.txt (private file on this computer)" ;;
  start)
    check_deps; [ -f "$CFG" ] || die "Not installed yet: run '$0 install' first."
    start_services; say "Running: http://127.0.0.1:$HTTP_PORT"; [ "${1:-}" = "--no-browser" ] || open_browser ;;
  stop) check_deps; stop_services; say "Stopped." ;;
  restart) check_deps; stop_services; start_services; say "Running: http://127.0.0.1:$HTTP_PORT" ;;
  status)
    check_deps
    for s in postgrest server; do if running "$s"; then say "$s: running"; else say "$s: stopped"; fi; done
    if "$PGBIN/pg_isready" -h "$RUN" -p "$PG_PORT" -q; then say "database: running"; else say "database: stopped"; fi
    curl -fs "http://127.0.0.1:$HTTP_PORT/api/health" && echo ;;
  url) say "http://127.0.0.1:$HTTP_PORT" ;;
  backup)
    check_deps; start_pg
    f="$PH_HOME/backups/packhouse-$(date +%Y-%m-%d-%H-%M)-manual.dump"
    "$PGBIN/pg_dump" -Fc -h "$RUN" -p "$PG_PORT" -U postgres -f "$f" "$DB"; say "Backup: $f" ;;
  restore)
    check_deps; file="${1:-}"; [ -f "$file" ] || die "Usage: $0 restore FILE"
    if [ "${PH_YES:-}" != "1" ]; then read -r -p "Replace the current database with $file? (yes/no) " a; [ "$a" = yes ] || die "Cancelled."; fi
    start_pg
    safety="$PH_HOME/backups/packhouse-$(date +%Y-%m-%d-%H-%M)-before-restore.dump"
    "$PGBIN/pg_dump" -Fc -h "$RUN" -p "$PG_PORT" -U postgres -f "$safety" "$DB" 2>/dev/null || true
    for s in server postgrest; do running "$s" && kill "$(cat "$RUN/$s.pid")" 2>/dev/null || true; rm -f "$RUN/$s.pid"; done
    psql_su -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
    "$PGBIN/pg_restore" -h "$RUN" -p "$PG_PORT" -U postgres -d "$DB" --no-owner --role=postgres "$file" || die "Restore failed; the safety copy is $safety"
    write_postgrest_conf; start_services; say "Restored from $file (safety copy: $safety)" ;;
  lan)
    check_deps
    case "${1:-}" in
      on) lan_certs; stop_services; start_services ;;
      off) node -e "const f='$CFG',c=require(f);delete c.PH_TLS_CERT;delete c.PH_TLS_KEY;require('fs').writeFileSync(f,JSON.stringify(c,null,2))"; stop_services; start_services; say "LAN access off." ;;
      *) die "Usage: $0 lan on|off" ;;
    esac ;;
  owner-code) say "$PH_HOME/OWNER-FIRST-SIGN-IN.txt" ;;
  *) die "Usage: $0 install [--demo] | start | stop | restart | status | url | backup | restore FILE | lan on|off | owner-code" ;;
esac
