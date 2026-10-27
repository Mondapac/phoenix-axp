import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const CTL = path.join(REPO_ROOT, 'infra/flowable/flowablectl.sh');

export const FLOWABLE_REST_URL =
  process.env.FLOWABLE_REST_URL ?? 'http://127.0.0.1:8090/flowable-rest/service';
const AUTH = 'Basic ' + Buffer.from('rest-admin:test').toString('base64');

/** Flowable's own database (ADR-0005: separate from the core's), as its own role. */
export const FLOWABLE_DATABASE_URL =
  process.env.FLOWABLE_DATABASE_URL ?? 'postgresql://flowable:flowable@127.0.0.1:5434/flowable';

/** Stops Flowable with SIGKILL (no clean shutdown) and waits until the port is closed. */
export function killFlowable(): void {
  execFileSync(CTL, ['kill'], { stdio: 'ignore' });
}

/** Starts Flowable and waits until its REST API answers (about 15 to 20 s). */
export function startFlowable(): void {
  execFileSync(CTL, ['start'], { stdio: 'ignore', timeout: 90_000 });
}

/**
 * Direct REST access for the test only: what an operator (or a bug) could do behind the
 * core's back. The bridge never uses it.
 */
export async function flowableRest(
  method: 'GET' | 'POST' | 'DELETE',
  pathAndQuery: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${FLOWABLE_REST_URL}${pathAndQuery}`, {
    method,
    headers: {
      authorization: AUTH,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text.length > 0 ? (JSON.parse(text) as unknown) : null };
}

interface Row {
  id: string;
  tenantId: string;
  businessKey?: string | null;
  deleteReason?: string | null;
  endTime?: string | null;
  processInstanceId?: string;
}

/** Removes every running instance of `tenantId` left by earlier runs (Flowable's DB persists). */
export async function clearTenant(tenantId: string): Promise<void> {
  for (;;) {
    const page = await flowableRest(
      'GET',
      `/runtime/process-instances?tenantId=${tenantId}&size=100`,
    );
    const rows = (page.json as { data: Row[] }).data.filter((row) => row.tenantId === tenantId);
    if (rows.length === 0) return;
    for (const row of rows) {
      await flowableRest('DELETE', `/runtime/process-instances/${row.id}?deleteReason=test-reset`);
    }
  }
}

/** Every instance (history) with this business key; the filter is re-checked here. */
export async function instancesOf(tenantId: string, businessKey: string): Promise<Row[]> {
  const page = await flowableRest(
    'GET',
    `/history/historic-process-instances?businessKey=${businessKey}&tenantId=${tenantId}&size=100`,
  );
  return (page.json as { data: Row[] }).data.filter(
    (row) => row.businessKey === businessKey && row.tenantId === tenantId,
  );
}

/** Open engine tasks of one instance. */
export async function openTasksOf(tenantId: string, instanceId: string): Promise<Row[]> {
  const page = await flowableRest(
    'GET',
    `/runtime/tasks?processInstanceId=${instanceId}&tenantId=${tenantId}&size=100`,
  );
  return (page.json as { data: Row[] }).data.filter(
    (row) => row.processInstanceId === instanceId && row.tenantId === tenantId,
  );
}

/** Every task the instance ever had. */
export async function historicTasksOf(tenantId: string, instanceId: string): Promise<Row[]> {
  const page = await flowableRest(
    'GET',
    `/history/historic-task-instances?processInstanceId=${instanceId}&tenantId=${tenantId}&size=100`,
  );
  return (page.json as { data: Row[] }).data.filter(
    (row) => row.processInstanceId === instanceId && row.tenantId === tenantId,
  );
}

/** A query on Flowable's own database, as Flowable's role. */
export async function flowableSql<T extends object>(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: FLOWABLE_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
