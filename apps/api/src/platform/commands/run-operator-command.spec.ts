import type { INestApplicationContext, LoggerService } from '@nestjs/common';
import { err, ok, Temporal } from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import { ID_GENERATOR } from '../ids/ids.module';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { CommandRegistry, type CommandContext } from './command-registry';
import {
  commandFailureLine,
  OPERATOR_COMMAND_EXIT,
  runOperatorCommand,
} from './run-operator-command';

// The operator command runner (platform/commands): the command and tenant from the command
// line, the system actor, and no echo of operator input or of an error message.

describe.each(TEST_TENANTS)('runOperatorCommand for tenant %s', (code) => {
  const tenant = testTenantContext(code);

  function appWith(failure: Error | null = null) {
    const calls: { context: CommandContext; argv: readonly string[] }[] = [];
    const registry = new CommandRegistry();
    registry.register('identity', [
      {
        name: 'identity.seed',
        usage: '--name <x>',
        run: (context, argv, write) => {
          calls.push({ context, argv });
          if (failure !== null) return Promise.reject(failure);
          write('{"outcome":"done"}');
          return Promise.resolve(2);
        },
      },
    ]);
    const factory = {
      forTenant: (requested: string) =>
        requested === code ? ok(tenant) : err({ code: 'tenant.not-hosted' }),
    };
    const ids = new SequenceIdGenerator(
      new FixedClock(Temporal.Instant.from('2026-10-27T06:00:00Z')),
    );
    const app = {
      get: (token: unknown) =>
        token === CommandRegistry
          ? registry
          : token === TenantContextFactory
            ? factory
            : token === ID_GENERATOR
              ? ids
              : undefined,
    } as unknown as INestApplicationContext;
    const logged: unknown[] = [];
    const logger = { log: (line: unknown) => logged.push(line) } as unknown as LoggerService;
    return { app, calls, logger, logged };
  }

  const run = async (argv: string[], failure: Error | null = null) => {
    const setup = appWith(failure);
    const lines: string[] = [];
    const errors: string[] = [];
    const exitCode = await runOperatorCommand(
      setup.app,
      argv,
      (l) => lines.push(l),
      (l) => errors.push(l),
      setup.logger,
    );
    return { ...setup, exitCode, lines, errors };
  };

  it("runs the command as the tenant's system actor with the remaining arguments", async () => {
    const { exitCode, calls, lines, errors, logged } = await run([
      'identity.seed',
      '--tenant',
      code,
      '--name',
      'x',
    ]);

    expect(exitCode).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.context.tenant).toEqual(tenant);
    expect(calls[0]!.context.actor.kind).toBe('system');
    expect(calls[0]!.argv).toEqual(['--name', 'x']);
    expect(lines).toEqual(['{"outcome":"done"}']);
    expect(errors).toEqual([]);
    expect(logged).toEqual([
      expect.objectContaining({
        msg: 'operator.command.ran',
        command: 'identity.seed',
        tenantId: tenant.tenantId,
        exitCode: 2,
      }),
    ]);
  });

  it.each([
    [[]],
    [['identity.unknown', '--tenant', code]],
    [['identity.seed']],
    [['identity.seed', '--tenant']],
    [['identity.seed', '--full', code]],
  ])('refuses %j with the usage and the command list', async (argv) => {
    const { exitCode, calls, lines } = await run(argv);
    expect(exitCode).toBe(OPERATOR_COMMAND_EXIT.refused);
    expect(calls).toEqual([]);
    expect(lines[1]).toBe('commands: identity.seed');
  });

  it('refuses a tenant this stack does not host, without echoing it', async () => {
    const { exitCode, calls, lines } = await run(['identity.seed', '--tenant', 'echo-me-not']);
    expect(exitCode).toBe(OPERATOR_COMMAND_EXIT.refused);
    expect(calls).toEqual([]);
    expect(lines.join('\n')).not.toContain('echo-me-not');
  });

  it('answers 3 with the class only when the command throws', async () => {
    const { exitCode, errors, lines } = await run(
      ['identity.seed', '--tenant', code],
      new TypeError('secret-sentinel'),
    );
    expect(exitCode).toBe(OPERATOR_COMMAND_EXIT.failed);
    expect(lines).toEqual([]);
    expect(errors).toEqual(['identity.seed: the command did not complete (TypeError)']);
  });
});

describe('commandFailureLine', () => {
  it('never prints the message of an error', () => {
    const error = new Error('value 42 in row');
    error.name = 'not a class name!';
    expect(commandFailureLine('identity.seed', error)).toBe(
      'identity.seed: the command did not complete (Error)',
    );
  });
});
