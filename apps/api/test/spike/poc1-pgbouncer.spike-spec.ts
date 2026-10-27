// SPIKE (PoC 1, slice 0.6): the same zero-leak runs through PgBouncer in transaction-pooling
// mode (spike/poc-1/pgbouncer/pgbouncer.ini: 8 server connections for every client).
import { productionPathRun, rawRlsRun } from './poc1-concurrency';
import { BOUNCER_URL, OWNER_URL, connect, ownerCounts, writeResult } from './poc1-support';

const ADMIN_URL = 'postgresql://pgbadmin:pgbadmin-poc@127.0.0.1:6433/pgbouncer';
const results: Record<string, unknown> = {};

/** Drops every server connection PgBouncer holds (admin console), so no state survives. */
async function resetServerConnections(): Promise<void> {
  const admin = await connect(ADMIN_URL);
  try {
    await admin.query('KILL phoenix_poc');
    await admin.query('RESUME phoenix_poc');
  } finally {
    await admin.end();
  }
}

describe('PoC 1 through PgBouncer (transaction pooling)', () => {
  afterAll(() => writeResult('pgbouncer', results));

  it('really multiplexes: many client connections share few server connections', async () => {
    const clients = await Promise.all(Array.from({ length: 40 }, () => connect(BOUNCER_URL)));
    const pids = new Set<number>();
    for (let round = 0; round < 5; round += 1) {
      for (const client of clients) {
        const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        pids.add(rows[0]!.pid);
      }
    }
    await Promise.all(clients.map((client) => client.end()));
    results.multiplexing = { clientConnections: 40, distinctServerBackends: pids.size };
    expect(pids.size).toBeLessThanOrEqual(8);
  });

  it('negative control: a session-level setting DOES leak to another client (the detector works)', async () => {
    await resetServerConnections();
    const counts = await ownerCounts('content.content_item');
    const writer = await connect(BOUNCER_URL);
    const reader = await connect(BOUNCER_URL);
    try {
      await writer.query("SELECT pg_catalog.set_config('app.tenant_id', 't0001', false)");
      let leakedRows = 0;
      for (let i = 0; i < 50 && leakedRows === 0; i += 1) {
        const { rows } = await reader.query<{ n: string }>(
          'SELECT count(*) AS n FROM content.content_item',
        );
        leakedRows = Number(rows[0]!.n);
      }
      results.sessionLevelSettingLeaksAcrossClients = leakedRows;
      expect(leakedRows).toBe(counts.get('t0001'));
    } finally {
      await writer.end();
      await reader.end();
      await resetServerConnections();
    }
  });

  it('transaction-local setting (what the UnitOfWork issues) never reaches another client', async () => {
    const writer = await connect(BOUNCER_URL);
    const reader = await connect(BOUNCER_URL);
    let seen = 0;
    try {
      for (let i = 0; i < 200; i += 1) {
        await writer.query('BEGIN');
        await writer.query("SELECT pg_catalog.set_config('app.tenant_id', 't0001', true)");
        await writer.query('SELECT count(*) FROM content.content_item');
        await writer.query('COMMIT');
        const { rows } = await reader.query<{ n: string; t: string | null }>(
          "SELECT count(*) AS n, current_setting('app.tenant_id', true) AS t FROM content.content_item",
        );
        seen += Number(rows[0]!.n) + (rows[0]!.t ? 1 : 0);
      }
    } finally {
      await writer.end();
      await reader.end();
    }
    results.transactionLocalSettingSeenByOtherClient = seen;
    expect(seen).toBe(0);
  });

  it('production path (UnitOfWork + guard + RLS) through PgBouncer: zero leaks', async () => {
    const report = await productionPathRun(
      BOUNCER_URL,
      'pgbouncer transaction mode, production path',
      {
        poolMax: 20,
        seed: 11,
      },
    );
    const owner = await connect(OWNER_URL);
    try {
      const ids = [...report.writtenByTenant.values()].flat();
      const { rows } = await owner.query<{ misplaced: string; found: string }>(
        `SELECT count(*) FILTER (WHERE tenant_id <> payload->>'writtenFor') AS misplaced, count(*) AS found
           FROM forms.form_submission WHERE form_key = 'concurrency' AND id = ANY($1::uuid[])`,
        [ids],
      );
      const { writtenByTenant: written, ...summary } = report;
      expect(written.size).toBeGreaterThan(0);
      results.concurrentProductionPath = {
        ...summary,
        writesFound: Number(rows[0]!.found),
        misplaced: Number(rows[0]!.misplaced),
      };
      expect(report.failures).toBe(0);
      expect(report.leaks).toBe(0);
      expect(Number(rows[0]!.found)).toBe(report.writes);
      expect(Number(rows[0]!.misplaced)).toBe(0);
      await owner.query("DELETE FROM forms.form_submission WHERE form_key = 'concurrency'");
    } finally {
      await owner.end();
    }
  });

  it('RLS alone, raw SQL, 64 clients over 8 server connections: zero leaks', async () => {
    const report = await rawRlsRun(BOUNCER_URL, 'pgbouncer transaction mode, raw SQL, RLS only', {
      poolMax: 64,
      seed: 12,
    });
    results.concurrentRawRls = report;
    expect(report.failures).toBe(0);
    expect(report.leaks).toBe(0);
  });
});
