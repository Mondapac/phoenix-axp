import { spawn } from 'node:child_process';
import path from 'node:path';
import { testDatabaseUrl } from '../../db/test-database';
import { FLOWABLE_REST_URL } from './flowable';

/**
 * Runs one relay pass in a separate worker process (the built API) and SIGKILLs it right after
 * the engine call `dieAfter` returned, before the relay could acknowledge it.
 */
export function killWorkerAfter(
  tenantId: string,
  dieAfter: 'startInstance' | 'completeTask',
  leaseMs: number,
): Promise<{ readonly killedAfter: string; readonly signal: string | null }> {
  const child = spawn(process.execPath, [path.join(__dirname, 'relay-child.cjs')], {
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: testDatabaseUrl(),
      HOSTED_TENANTS: 'demo-fa,demo-en',
      TENANT: tenantId,
      DIE_AFTER: dieAfter,
      LEASE_MS: String(leaseMs),
      FLOWABLE_REST_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker did not reach ${dieAfter}: ${output} ${errors}`));
    }, 30_000);
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /engine-call-done (\w+)/.exec(output);
      if (match) child.kill('SIGKILL');
    });
    child.on('exit', (_code, signal) => {
      clearTimeout(timer);
      const match = /engine-call-done (\w+)/.exec(output);
      if (match) resolve({ killedAfter: match[1]!, signal });
      else reject(new Error(`worker exited early: ${output} ${errors}`));
    });
  });
}
