#!/usr/bin/env bash
# Restore a backup (downloaded from Settings → Backup, pg_dump custom format) into an EMPTY PostgreSQL database.
#   TARGET_URL=postgres://owner:pw@host/db PH_AUTHENTICATOR_PASSWORD=… PH_SERVER_DB_PASSWORD=… deploy/restore.sh FILE.dump
# Then point the hosted service's DATABASE_URL at TARGET_URL and redeploy: the start applies any newer migrations.
set -euo pipefail
file="${1:?usage: deploy/restore.sh FILE.dump}"; : "${TARGET_URL:?TARGET_URL is required}"
cd "$(dirname "$0")/.."
tables=$(psql "$TARGET_URL" -X -tAc "select count(*) from information_schema.tables where table_schema in ('public','app')")
[ "$tables" = "0" ] || { echo "Target database is not empty ($tables tables): refusing to restore over it." >&2; exit 1; }
DATABASE_URL="$TARGET_URL" node deploy/migrate.mjs --roles-only
# Grants in the backup may name the old database owner: create any such role here (no login) so every grant restores.
for r in $(pg_restore -f - -s "$file" | sed -nE 's/^GRANT .* TO ([A-Za-z0-9_"]+);$/\1/p' | tr -d '"' | sort -u); do
  psql "$TARGET_URL" -X -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$r') then create role \"$r\" nologin; end if; end \$\$"
done
# Default privileges belong to the old database owner; the start step recreates them for the new owner.
list=$(mktemp); pg_restore -l "$file" | grep -v ' DEFAULT ACL ' > "$list"
pg_restore --no-owner --exit-on-error -L "$list" -d "$TARGET_URL" "$file"; rm -f "$list"
DATABASE_URL="$TARGET_URL" node deploy/migrate.mjs
echo "Restored $file"
