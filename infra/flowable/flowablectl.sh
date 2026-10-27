#!/usr/bin/env bash
# PoC 3 (spike): start | stop | kill | status of the local Flowable REST process that
# run-flowable.sh launches. The failure tests call `kill` (SIGKILL, an outage with no clean
# shutdown) and `start` to bring the engine back. State (pid file, log) lives in
# FLOWABLE_STATE_DIR, default $TMPDIR/phoenix-flowable.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
state="${FLOWABLE_STATE_DIR:-${TMPDIR:-/tmp}/phoenix-flowable}"
mkdir -p "$state"
pidfile="$state/flowable.pid"
url="http://127.0.0.1:${FLOWABLE_PORT:-8090}/flowable-rest/service/management/engine"

running() { [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }
ready() { curl -sf -u rest-admin:test "$url" >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    if ! running; then
      setsid "$here/run-flowable.sh" >>"$state/flowable.log" 2>&1 < /dev/null &
      echo $! >"$pidfile"
    fi
    for _ in $(seq 1 120); do ready && { echo ready; exit 0; }; sleep 0.5; done
    echo "flowable did not become ready" >&2; exit 1 ;;
  stop|kill)
    signal=TERM; [[ "$1" == kill ]] && signal=KILL
    if running; then kill -s "$signal" "$(cat "$pidfile")"; fi
    for _ in $(seq 1 60); do running || { rm -f "$pidfile"; echo stopped; exit 0; }; sleep 0.5; done
    echo "flowable did not stop" >&2; exit 1 ;;
  status) if ready; then echo ready; elif running; then echo starting; else echo down; fi ;;
  *) echo "usage: $0 start|stop|kill|status" >&2; exit 2 ;;
esac
