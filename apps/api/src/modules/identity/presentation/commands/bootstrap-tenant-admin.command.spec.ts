import { err, ok } from '@phoenix/shared-kernel';
import { testCallContext, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../../test/support/test-config';
import type { CommandContext } from '../../../../platform/commands/command-registry';
import type { BootstrapTenantAdministrator } from '../../application/use-cases/bootstrap-tenant-administrator.use-case';
import {
  BOOTSTRAP_TENANT_ADMIN_EXIT,
  bootstrapTenantAdminCommand,
} from './bootstrap-tenant-admin.command';

// `identity.bootstrap-tenant-admin`: its arguments, its exit codes, and an output that never
// carries the username. The use case itself is tested against PostgreSQL (identity.db-spec.ts).

const ACCOUNT = '01990000-0000-7000-8000-000000000001';

describe.each(TEST_TENANTS)('the first-administrator command in tenant %s', (code) => {
  const context = testCallContext(testTenantContext(code), 'system') as CommandContext;

  function commandAnswering(answer: unknown) {
    const inputs: unknown[] = [];
    const useCase = {
      execute: (_context: unknown, input: unknown) => {
        inputs.push(input);
        return Promise.resolve(answer);
      },
    } as unknown as BootstrapTenantAdministrator;
    return { command: bootstrapTenantAdminCommand(useCase), inputs };
  }

  const run = async (answer: unknown, argv: string[]) => {
    const { command, inputs } = commandAnswering(answer);
    const lines: string[] = [];
    const exitCode = await command.run(context, argv, (l) => lines.push(l));
    return { exitCode, lines, inputs };
  };

  it('exits 0 when granted and 2 while the account is pending', async () => {
    const granted = await run(ok({ outcome: 'granted', accountId: ACCOUNT }), [
      '--username',
      'name-sentinel',
      '--account',
      ACCOUNT,
    ]);
    expect(granted.exitCode).toBe(BOOTSTRAP_TENANT_ADMIN_EXIT.granted);
    expect(granted.inputs).toEqual([{ username: 'name-sentinel', accountId: ACCOUNT }]);
    expect(granted.lines).toEqual([`{"outcome":"granted","accountId":"${ACCOUNT}"}`]);

    const waiting = await run(
      ok({ outcome: 'sign-in-needed', accountId: ACCOUNT, created: true }),
      ['--username', 'name-sentinel'],
    );
    expect(waiting.exitCode).toBe(BOOTSTRAP_TENANT_ADMIN_EXIT.pending);
    expect(waiting.inputs).toEqual([{ username: 'name-sentinel' }]);
    expect(waiting.lines.join('')).not.toContain('name-sentinel');

    const confirm = await run(ok({ outcome: 'confirm-needed', accountId: ACCOUNT }), [
      '--username',
      'name-sentinel',
    ]);
    expect(confirm.exitCode).toBe(BOOTSTRAP_TENANT_ADMIN_EXIT.pending);
  });

  it('exits 1 with the refusal code only', async () => {
    const refused = await run(err({ code: 'identity.tenant.has-administrator' }), [
      '--username',
      'name-sentinel',
    ]);
    expect(refused.exitCode).toBe(BOOTSTRAP_TENANT_ADMIN_EXIT.refused);
    expect(refused.lines).toEqual([
      '{"outcome":"refused","code":"identity.tenant.has-administrator"}',
    ]);
  });

  it.each([
    [[]],
    [['--username']],
    [['--user', 'x']],
    [['--username', 'x', 'y']],
    [['--username', 'x', '--account']],
    [['--username', 'x', '--account', 'not-an-id']],
    [['--username', 'x', '--account', ACCOUNT, 'extra']],
  ])('refuses %j with the usage, without running the use case', async (argv) => {
    const { exitCode, inputs, lines } = await run(ok({}), argv);
    expect(exitCode).toBe(BOOTSTRAP_TENANT_ADMIN_EXIT.refused);
    expect(inputs).toEqual([]);
    expect(lines[0]).toMatch(/^usage: /);
  });
});
