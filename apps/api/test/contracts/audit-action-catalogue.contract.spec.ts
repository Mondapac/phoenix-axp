import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditActionDescription } from '@phoenix/shared-kernel';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AuditActionCatalogue,
  compareAuditCatalogueWithSnapshot,
} from '../../src/platform/audit/audit-action-catalogue';
import { AUDIT_WRITER } from '../../src/platform/audit/audit-writer';
import { AUDIT_SEAL_JOB, AUDIT_VERIFY_JOB } from '../../src/platform/audit/audit-jobs';
import { JobRegistry } from '../../src/platform/scheduler/job-registry';
import { TenancyModule } from '../../src/modules/tenancy';
import { createTestApp } from '../support/test-app';

// The contract of Phoenix ADR-0015 decision 2, ported in part from Mondapac's
// test/contracts/audit-action-catalogue.contract.spec.ts: the audit action catalogue of the
// booted application equals the checked-in snapshot, so every new or changed action is read in
// review. Mondapac's per-module check that a writer is bound inside its module, never at the
// root, arrived with tenancy, the first module that audits.

const SNAPSHOT = path.join(__dirname, 'audit-action-catalogue.snapshot.json');

describe('the audit action catalogue (contract)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('is sealed at bootstrap and equals the checked-in snapshot', () => {
    const catalogue = app.get(AuditActionCatalogue);
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as AuditActionDescription[];

    expect(catalogue.sealed).toBe(true);
    expect(compareAuditCatalogueWithSnapshot(catalogue.snapshot(), snapshot)).toEqual([]);
  });

  it('binds no AUDIT_WRITER at the root: a writer is bound per module only', () => {
    expect(() => {
      app.get<unknown>(AUDIT_WRITER, { strict: true });
    }).toThrow();
    expect(app.select(TenancyModule).get<unknown>(AUDIT_WRITER, { strict: true })).toBeDefined();
  });

  it('registers the sealer and verifier jobs with the scheduler', () => {
    expect(app.get(JobRegistry).names()).toEqual(
      expect.arrayContaining([AUDIT_SEAL_JOB, AUDIT_VERIFY_JOB]),
    );
  });
});
