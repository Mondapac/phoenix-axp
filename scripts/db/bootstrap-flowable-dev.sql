-- Flowable's own database and login for development and CI only (slice 2.1; PoC 3, R9;
-- ADR-0005: Flowable's tables never live in the core's database).
--
-- Creates the login `flowable` and the database `flowable` it owns. Neither side can reach the
-- other: PUBLIC has no CONNECT on `flowable`, and bootstrap-dev.sql already took CONNECT on the
-- core database from PUBLIC. Flowable creates and upgrades its own tables. Run it as the
-- cluster superuser over the Unix socket, after bootstrap-dev.sql:
--   docker compose: runs once on a fresh volume (/docker-entrypoint-initdb.d), and again with
--                   `pnpm db:bootstrap`
--   native PostgreSQL: psql -d phoenix -f scripts/db/bootstrap-flowable-dev.sql
--
-- The password is a local-only default, never a secret. It converges: running it again is safe.
-- Production does not use this file.

\set ON_ERROR_STOP on

-- Socket or loopback only, so this known password never lands on a remote cluster.
DO $guard$
BEGIN
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= inet '127.0.0.0/8' OR inet_server_addr() = inet '::1') THEN
    RAISE EXCEPTION 'bootstrap-flowable-dev.sql runs only over the Unix socket or loopback'
      USING HINT = 'Connect with psql inside the container or on this machine, without -h.';
  END IF;
END
$guard$;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'flowable') THEN
    CREATE ROLE flowable LOGIN;
  END IF;
END
$role$;

-- A plain login: no superuser, no RLS bypass, member of no core role.
ALTER ROLE flowable LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS PASSWORD 'flowable';
DO $membership$
DECLARE
  granted text;
BEGIN
  FOR granted IN
    SELECT r.rolname FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'flowable')
  LOOP
    EXECUTE format('REVOKE %I FROM flowable', granted);
  END LOOP;
END
$membership$;

-- CREATE DATABASE cannot run inside a function or a transaction block.
SELECT 'CREATE DATABASE flowable OWNER flowable ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = 'flowable')
\gexec

ALTER DATABASE flowable OWNER TO flowable;
REVOKE ALL ON DATABASE flowable FROM PUBLIC;
