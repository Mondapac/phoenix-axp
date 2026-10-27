#!/bin/sh
# Refuses to start the engine on the base image's defaults: an in-memory H2 database (timers and
# instances lost on restart) or the published admin password. Then hands over to Flowable's own
# entrypoint.
set -eu

fail() {
  echo "phoenix-flowable: $1" >&2
  exit 64
}

case "${SPRING_DATASOURCE_URL:-}" in
  jdbc:postgresql://*) ;;
  *) fail 'SPRING_DATASOURCE_URL must name a PostgreSQL database of its own (jdbc:postgresql://host:port/flowable)' ;;
esac
[ -n "${SPRING_DATASOURCE_USERNAME:-}" ] || fail 'SPRING_DATASOURCE_USERNAME is required'
[ -n "${SPRING_DATASOURCE_PASSWORD:-}" ] || fail 'SPRING_DATASOURCE_PASSWORD is required'
[ -n "${FLOWABLE_REST_APP_ADMIN_USERID:-}" ] || fail 'FLOWABLE_REST_APP_ADMIN_USERID is required'
case "${FLOWABLE_REST_APP_ADMIN_PASSWORD:-}" in
  '' | test) fail 'FLOWABLE_REST_APP_ADMIN_PASSWORD is required and must not be the published default' ;;
esac

exec /flowable-entrypoint.sh "$@"
