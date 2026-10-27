#!/usr/bin/env bash
# PoC 2 (slice 0.7): test LDAP, Keycloak realms and the core database.
#   LDAP:      UnboundID in-memory directory on 127.0.0.1:10389 (test-only; LGPL-2.1 option)
#   Keycloak:  26.x distribution, `kc.sh start-dev --http-port 8181` (Apache-2.0)
#   Database:  phoenix_poc2 on the spike cluster, migrated, two tenant fixtures seeded
# Usage: LDAP_JAR=/path/unboundid-ldapsdk.jar KEYCLOAK_HOME=/path/keycloak-26.x spike/poc-2/setup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5433}
SUPER="psql -X -q -h ${PGSOCKET:-$PGHOST} -p $PGPORT -U postgres -v ON_ERROR_STOP=1"
MIGRATOR_URL="postgresql://phoenix_migrator:phoenix_migrator@$PGHOST:$PGPORT"

if [ "${START_SERVICES:-0}" = 1 ]; then
  pkill -f '[I]nMemoryLdap' || true
  nohup java -cp "$LDAP_JAR" spike/poc-2/ldap/InMemoryLdap.java 10389 spike/poc-2/ldap/directory.ldif >/tmp/poc2-ldap.log 2>&1 &
  sleep 5
fi
node spike/poc-2/keycloak/setup-realms.mjs

$SUPER -d postgres -c "DROP DATABASE IF EXISTS phoenix_poc2 WITH (FORCE)"
$SUPER -d postgres -c "CREATE DATABASE phoenix_poc2 OWNER phoenix_migrator"
$SUPER -d postgres -c "REVOKE ALL ON DATABASE phoenix_poc2 FROM PUBLIC; GRANT CONNECT ON DATABASE phoenix_poc2 TO phoenix_app"
MIGRATION_DATABASE_URL="$MIGRATOR_URL/phoenix_poc2" pnpm exec prisma migrate deploy >/dev/null
psql -X -q "$MIGRATOR_URL/phoenix_poc2" -v ON_ERROR_STOP=1 -f spike/poc-2/seed.sql
echo "PoC 2 environment ready"
