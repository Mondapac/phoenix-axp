#!/usr/bin/env bash
# PoC 1 (slice 0.6): creates the seeded databases of the spike on the local cluster.
#   phoenix_poc        migrated + seeded, row-level security on (production shape)
#   phoenix_poc_norls  a copy with row-level security switched off on every tenant table
#                      (the "guard only" baseline of the overhead measurement)
# Needs: PGHOST/PGPORT of the cluster, the superuser for CREATE DATABASE ... TEMPLATE, and the
# roles of scripts/db/bootstrap-dev.sql.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5433}
SUPER="psql -X -q -h ${PGSOCKET:-$PGHOST} -p $PGPORT -U postgres -v ON_ERROR_STOP=1"
MIGRATOR_URL="postgresql://phoenix_migrator:phoenix_migrator@$PGHOST:$PGPORT"

for db in phoenix_poc_norls phoenix_poc; do
  $SUPER -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"
done
$SUPER -d postgres -c "CREATE DATABASE phoenix_poc OWNER phoenix_migrator"
$SUPER -d postgres -c "REVOKE ALL ON DATABASE phoenix_poc FROM PUBLIC; GRANT CONNECT ON DATABASE phoenix_poc TO phoenix_app"
MIGRATION_DATABASE_URL="$MIGRATOR_URL/phoenix_poc" pnpm exec prisma migrate deploy >/dev/null
time psql -X -q "$MIGRATOR_URL/phoenix_poc" -f spike/poc-1/seed.sql

$SUPER -d postgres -c "CREATE DATABASE phoenix_poc_norls TEMPLATE phoenix_poc OWNER phoenix_migrator"
$SUPER -d postgres -c "REVOKE ALL ON DATABASE phoenix_poc_norls FROM PUBLIC; GRANT CONNECT ON DATABASE phoenix_poc_norls TO phoenix_app"
psql -X -q "$MIGRATOR_URL/phoenix_poc_norls" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.nspname, r.relname);
  END LOOP;
END $$;
ANALYZE;
SQL
echo "seeded:"
psql -X "$MIGRATOR_URL/phoenix_poc" -c "SELECT 'sites' AS t, count(*) FROM site.site UNION ALL SELECT 'ancestry', count(*) FROM site.site_ancestry UNION ALL SELECT 'content', count(*) FROM content.content_item UNION ALL SELECT 'submissions', count(*) FROM forms.form_submission UNION ALL SELECT 'roles', count(*) FROM identity.role UNION ALL SELECT 'grants', count(*) FROM identity.role_grant UNION ALL SELECT 'tenants', count(DISTINCT tenant_id) FROM site.site"
