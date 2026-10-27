#!/usr/bin/env bash
# PoC 3 (spike): runs Flowable REST 7.1.0 from its released war, without Docker, against its
# OWN PostgreSQL database (`flowable`, role `flowable`), never the core's database (ADR-0005).
# The war ships H2 only; the PostgreSQL JDBC driver (BSD-2-Clause) is added to WEB-INF/lib.
#
#   FLOWABLE_WAR=/path/flowable-rest-pg.war PGPORT=5434 infra/flowable/run-flowable.sh
#
# Timer acquisition is shortened to 1 s so the escalation tests run in seconds.
set -euo pipefail
: "${FLOWABLE_WAR:?path of the repacked flowable-app-rest-7.1.0.war}"
PGPORT="${PGPORT:-5434}"
FLOWABLE_PORT="${FLOWABLE_PORT:-8090}"
exec java -Xmx768m -jar "$FLOWABLE_WAR" \
  --server.port="$FLOWABLE_PORT" \
  --spring.datasource.url="jdbc:postgresql://127.0.0.1:${PGPORT}/flowable" \
  --spring.datasource.username=flowable \
  --spring.datasource.password=flowable \
  --spring.datasource.hikari.minimumIdle=2 \
  --spring.datasource.hikari.maximumPoolSize=10 \
  --flowable.rest.app.create-demo-definitions=false \
  --flowable.rest.app.admin.user-id=rest-admin \
  --flowable.rest.app.admin.password=test \
  --flowable.database-schema-update=true \
  --flowable.process.async.executor.default-timer-job-acquire-wait-time=1s \
  --flowable.process.async.executor.default-async-job-acquire-wait-time=1s \
  --flowable.history-level=full
