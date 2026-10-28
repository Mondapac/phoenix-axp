// Phoenix ADR-0024: each submission path gets only the half of the field access it needs
// (security review of PR #34, L1), on both tenant fixtures.
import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import {
  testAuthenticatedActor,
  testCallContext,
  testTenantContext,
} from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import {
  ALL_DEFINITIONS,
  type FieldDescriptor,
  type FieldGrant,
  type FieldRuleReader,
  type PermissionKey,
  type SiteAncestryReader,
} from '../../../platform/authz';
import { FORMS_SUBMISSION_READ, FORMS_SUBMISSION_SUBMIT_ON_BEHALF } from '../contracts/permissions';
import { SubmissionAccess } from './submission-access';

const id = <K extends string>(n: number): Id<K> => {
  const parsed = parseId<K>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};

const FORM = { id: id<'Form'>(100), siteId: id<'Site'>(50) };
const NAME = id<'Field'>(1);
const NOTE = id<'Field'>(2);
const FIELDS: readonly FieldDescriptor[] = [
  { id: NAME, sensitive: false },
  { id: NOTE, sensitive: false },
];

// One grant holding both keys: each path must still see only its own half.
const both: FieldGrant = {
  scope: { level: 'tenant' },
  keys: new Set<PermissionKey>([FORMS_SUBMISSION_READ.key, FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key]),
  qualifiers: new Map([
    [FORMS_SUBMISSION_READ.key, ALL_DEFINITIONS],
    [FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key, ALL_DEFINITIONS],
  ]),
  fieldRules: new Map(),
};
const rules: FieldRuleReader = { grantsFor: () => Promise.resolve([both]) };
const sites: SiteAncestryReader = {
  siteExists: () => Promise.resolve(true),
  isWithinSubtree: () => Promise.resolve(false),
  sitesWithin: (_c, root) => Promise.resolve([root]),
};

describe.each(TEST_TENANTS)('SubmissionAccess in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const staff = testCallContext(
    tenant,
    testAuthenticatedActor(tenant, {
      population: 'tenant-staff',
      accountId: id<'Account'>(7),
      sessionId: id<'Session'>(8),
    }),
  );
  const hidden = new Map([
    [NAME, 'hidden'],
    [NOTE, 'hidden'],
  ]);

  it('gives the read path no write half', async () => {
    const access = await new SubmissionAccess(rules, sites).forRead(staff, FORM, FIELDS);
    expect(access.canRead).toBe(true);
    expect(access.readModes.get(NAME)).toBe('read');
    expect(access.canWrite).toBe(false);
    expect(access.writeModes).toEqual(hidden);
  });

  it('gives the on-behalf path no read half', async () => {
    const access = await new SubmissionAccess(rules, sites).forOnBehalf(staff, FORM, FIELDS);
    expect(access.canWrite).toBe(true);
    expect(access.writeModes.get(NOTE)).toBe('edit');
    expect(access.canRead).toBe(false);
    expect(access.readModes).toEqual(hidden);
  });
});
