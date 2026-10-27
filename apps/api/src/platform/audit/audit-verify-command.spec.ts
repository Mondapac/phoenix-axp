// Ported from Mondapac apps/api/src/platform/audit/audit-verify-command.spec.ts, Market adapted to Tenant.
import { err, ok } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator, testTenantContext } from '@phoenix/shared-kernel/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import { TEST_TENANTS } from '../../../test/support/test-config';
import { ID_GENERATOR } from '../ids/ids.module';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import {
  AUDIT_VERIFY_EXIT,
  AUDIT_VERIFY_USAGE,
  failureLine,
  parseAuditVerifyArguments,
  runAuditVerifyCommand,
} from './audit-verify-command';
import { AuditVerifier, type VerifyReport } from './audit-verifier';

// The operator command `audit-verify --tenant <id> [--full]` (Mondapac docs/design/domain/platform-audit.md
// 8): its arguments, its exit codes, and an output with positions and codes only.

describe('parseAuditVerifyArguments', () => {
  it.each([
    [['--tenant', 'demo-fa'], { tenantId: 'demo-fa', full: false }],
    [['--full', '--tenant', 'demo-en'], { tenantId: 'demo-en', full: true }],
    [['--tenant', 'demo-fa', '--full'], { tenantId: 'demo-fa', full: true }],
  ])('reads %j', (argv, expected) => {
    expect(parseAuditVerifyArguments(argv)).toEqual(ok(expected));
  });

  it.each([
    [[]],
    [['--full']],
    [['--tenant']],
    [['--tenant', '']],
    [['--tenant', 'demo-fa', '--tenant', 'demo-en']],
    [['--tenant', 'demo-fa', '--full', '--full']],
    [['--tenant', 'demo-fa', 'extra']],
    [['--tenant=AU']],
  ])('refuses %j', (argv) => {
    expect(parseAuditVerifyArguments(argv)).toEqual(err('usage'));
  });
});

describe.each(TEST_TENANTS)('runAuditVerifyCommand for tenant %s', (code) => {
  const tenant = testTenantContext(code);

  function appWith(report: Partial<VerifyReport>, failure: Error | null = null) {
    const calls: [TenantContext, string, string][] = [];
    const verifier = {
      verify: (
        context: { tenant: TenantContext; actor: { kind: string }; correlationId: string },
        mode: string,
      ) => {
        calls.push([context.tenant, mode, context.actor.kind]);
        if (failure !== null) return Promise.reject(failure);
        return Promise.resolve({
          tenantId: context.tenant.tenantId,
          mode,
          pinnedHead: 4n,
          fromSeq: 1n,
          sealsChecked: 4,
          lateSeals: 0,
          findings: [],
          findingTotals: {},
          totalsAtLeast: [],
          complete: true,
          ...report,
        });
      },
    };
    const factory = {
      forTenant: (requested: string) =>
        requested === code ? ok(tenant) : err({ code: 'tenant.not-hosted' }),
    };
    const ids = new SequenceIdGenerator(
      new FixedClock(Temporal.Instant.from('2026-10-08T06:00:00Z')),
    );
    const app = {
      get: (token: unknown) =>
        token === AuditVerifier
          ? verifier
          : token === TenantContextFactory
            ? factory
            : token === ID_GENERATOR
              ? ids
              : undefined,
    } as unknown as INestApplicationContext;
    return { app, calls };
  }

  it('runs an incremental verification as the system actor and exits 0 with no finding', async () => {
    const { app, calls } = appWith({});
    const lines: string[] = [];
    const errors: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', code],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.clean);
    expect(calls).toEqual([[tenant, 'incremental', 'system']]);
    expect(JSON.parse(lines[0]!)).toEqual({
      tenantId: code,
      mode: 'incremental',
      pinnedHead: '4',
      fromSeq: '1',
      sealsChecked: 4,
      lateSeals: 0,
      complete: true,
      findingTotals: {},
      totalsAtLeast: [],
      findings: [],
    });
    expect(errors).toEqual([]);
  });

  it('runs a full verification with --full and exits 2 with findings, positions only', async () => {
    const { app, calls } = appWith({
      findings: [
        {
          code: 'audit.row.mismatch',
          tenantId: code,
          epoch: 1,
          chainSeq: 2n,
          auditLogId: '01990000-0000-7000-8000-000000000002',
        },
      ],
    });
    const lines: string[] = [];
    const errors: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', code, '--full'],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.findings);
    expect(calls[0]![1]).toBe('full');
    expect((JSON.parse(lines[0]!) as { findings: unknown }).findings).toEqual([
      {
        code: 'audit.row.mismatch',
        epoch: 1,
        chainSeq: '2',
        auditLogId: '01990000-0000-7000-8000-000000000002',
      },
    ]);
  });

  it('refuses a usage error and a tenant this stack does not host, without echoing it', async () => {
    const { app, calls } = appWith({});
    const lines: string[] = [];
    const errors: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant'],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.refused);
    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', 'XX<script>'],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.refused);
    expect(lines[0]).toBe(AUDIT_VERIFY_USAGE);
    expect(lines[1]).not.toContain('XX');
    expect(calls).toEqual([]);
  });

  it('exits 2 when an incomplete run already found something: a finding wins (Mohammad C2)', async () => {
    const { app } = appWith({
      complete: false,
      findings: [
        {
          code: 'audit.chain.broken',
          tenantId: code,
          epoch: 1,
          chainSeq: 7n,
          auditLogId: '01990000-0000-7000-8000-000000000007',
        },
      ],
    });
    const lines: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', code],
        (l) => lines.push(l),
        (l) => lines.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.findings);
    expect((JSON.parse(lines[0]!) as { complete: boolean }).complete).toBe(false);
  });

  it('exits 3 when the verification ran out of its budget, with the report written', async () => {
    const { app } = appWith({ complete: false });
    const lines: string[] = [];
    const errors: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', code],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.incomplete);
    expect((JSON.parse(lines[0]!) as { complete: boolean }).complete).toBe(false);
  });

  it('exits 3 when the verification throws, printing the class and SQLSTATE, never the message (Mohammad 8)', async () => {
    const secret = 'Key (id)=(01990000-0000-7000-8000-00000000beef) value "amina@example.com"';
    const databaseError = Object.assign(new Error(secret), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '57014', originalMessage: secret } } },
    });
    const { app } = appWith({}, databaseError);
    const lines: string[] = [];
    const errors: string[] = [];

    await expect(
      runAuditVerifyCommand(
        app,
        ['--tenant', code, '--full'],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).resolves.toBe(AUDIT_VERIFY_EXIT.incomplete);
    expect(lines).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^audit-verify: the verification did not complete \(PrismaClientKnownRequestError/,
    );
    expect(errors[0]).not.toContain('amina');
    expect(errors[0]).not.toContain('beef');
  });

  it('names a non-identifier error class as Error', () => {
    const odd = Object.assign(new Error('x'), { name: 'a b <c>' });
    expect(failureLine(odd)).toBe('audit-verify: the verification did not complete (Error)');
    expect(failureLine('not an error', 'the start failed')).toBe(
      'audit-verify: the start failed (Error)',
    );
  });
});
