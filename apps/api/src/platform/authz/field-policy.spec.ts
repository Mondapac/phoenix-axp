// Phoenix ADR-0024: the field evaluator, its projection and write check, the definition
// qualifier, and the request-level resolution through the two ports, on both tenant fixtures.
import { parseId } from '@phoenix/shared-kernel';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  testAuthenticatedActor,
  testCallContext,
  testTenantContext,
} from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import type { PermissionKey } from './access-rule';
import {
  ALL_DEFINITIONS,
  grantCoversDefinition,
  qualifierWithin,
  type DefinitionQualifier,
} from './definition-scope';
import {
  FieldPolicy,
  resolveFieldAccess,
  type FieldDescriptor,
  type FieldGrant,
  type FieldMode,
  type FieldRequest,
  type FieldRuleReader,
} from './field-policy';
import { FailClosedFieldRuleReader } from './placeholders/fail-closed-field-rule-reader';
import { FailClosedSiteAncestryReader } from './placeholders/fail-closed-site-ancestry-reader';
import type { GrantScope } from './roles/role-model';
import type { SiteAncestryReader } from './site-scope';

const id = <K extends string>(n: number): Id<K> => {
  const parsed = parseId<K>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};

const READ = 'objects.record.read' as PermissionKey;
const UPDATE = 'objects.record.update' as PermissionKey;
const CREATE = 'objects.record.create' as PermissionKey;
const DEFINITION = id<'Definition'>(100);
const OTHER_DEFINITION = id<'Definition'>(101);
const NAME = id<'Field'>(1);
const NOTE = id<'Field'>(2);
const NATIONAL_ID = id<'Field'>(3);
const SITE = id<'Site'>(50);
const CHILD_SITE = id<'Site'>(51);

const FIELDS: readonly FieldDescriptor[] = [
  { id: NAME, sensitive: false, portal: 'read' },
  { id: NOTE, sensitive: false },
  { id: NATIONAL_ID, sensitive: true, portal: 'edit' },
];

const only = (...ids: Id<'Definition'>[]): DefinitionQualifier => ({
  all: false,
  definitionIds: new Set(ids),
});

function grant(
  keys: PermissionKey[],
  options: {
    qualifier?: DefinitionQualifier;
    rules?: [Id<'Field'>, FieldMode][];
    scope?: GrantScope;
  } = {},
): FieldGrant {
  const qualifier = options.qualifier ?? ALL_DEFINITIONS;
  return {
    scope: options.scope ?? { level: 'tenant' },
    keys: new Set(keys),
    qualifiers: new Map(keys.map((key) => [key, qualifier])),
    fieldRules: new Map(options.rules ?? []),
  };
}

const request = (overrides: Partial<FieldRequest> = {}): FieldRequest => ({
  definitionId: DEFINITION,
  operations: { read: READ, write: UPDATE },
  fields: FIELDS,
  ...overrides,
});

const modesOf = (grants: FieldGrant[], overrides: Partial<FieldRequest> = {}) =>
  Object.fromEntries(FieldPolicy.evaluate(grants, request(overrides)).modes);

describe('the definition qualifier', () => {
  it('covers every definition under all, the listed ones otherwise, none without one', () => {
    const listed = { qualifiers: new Map([[READ, only(DEFINITION)]]) };
    expect(
      grantCoversDefinition(
        { qualifiers: new Map([[READ, ALL_DEFINITIONS]]) },
        READ,
        OTHER_DEFINITION,
      ),
    ).toBe(true);
    expect(grantCoversDefinition(listed, READ, DEFINITION)).toBe(true);
    expect(grantCoversDefinition(listed, READ, OTHER_DEFINITION)).toBe(false);
    expect(grantCoversDefinition(listed, UPDATE, DEFINITION)).toBe(false);
  });

  it('orders qualifiers: a list within all or a wider list, never all within a list', () => {
    expect(qualifierWithin(only(DEFINITION), ALL_DEFINITIONS)).toBe(true);
    expect(qualifierWithin(only(DEFINITION), only(DEFINITION, OTHER_DEFINITION))).toBe(true);
    expect(qualifierWithin(only(DEFINITION, OTHER_DEFINITION), only(DEFINITION))).toBe(false);
    expect(qualifierWithin(ALL_DEFINITIONS, only(DEFINITION))).toBe(false);
    expect(qualifierWithin(ALL_DEFINITIONS, ALL_DEFINITIONS)).toBe(true);
  });
});

describe('FieldPolicy.evaluate', () => {
  it('without a rule, a field follows the operation; a sensitive field stays hidden (D9)', () => {
    expect(modesOf([grant([READ])])).toEqual({
      [NAME]: 'read',
      [NOTE]: 'read',
      [NATIONAL_ID]: 'hidden',
    });
    expect(modesOf([grant([READ, UPDATE])])).toEqual({
      [NAME]: 'edit',
      [NOTE]: 'edit',
      [NATIONAL_ID]: 'hidden',
    });
  });

  it('a rule opens a sensitive field and narrows another', () => {
    const rules: [Id<'Field'>, FieldMode][] = [
      [NATIONAL_ID, 'read'],
      [NOTE, 'hidden'],
    ];
    expect(modesOf([grant([READ, UPDATE], { rules })])).toEqual({
      [NAME]: 'edit',
      [NOTE]: 'hidden',
      [NATIONAL_ID]: 'read',
    });
  });

  it('never makes a field wider than its operation: edit without update is read', () => {
    expect(modesOf([grant([READ], { rules: [[NAME, 'edit']] })])[NAME]).toBe('read');
  });

  it('on create, the create key gives edit unless a rule narrows it', () => {
    const access = FieldPolicy.evaluate(
      [grant([CREATE], { rules: [[NOTE, 'read']] })],
      request({ operations: { read: READ, write: CREATE } }),
    );
    expect(access.canWrite).toBe(true);
    expect(access.canRead).toBe(false);
    expect(Object.fromEntries(access.modes)).toEqual({
      [NAME]: 'edit',
      [NOTE]: 'read',
      [NATIONAL_ID]: 'hidden',
    });
  });

  it('takes the widest mode over the grants', () => {
    const narrow = grant([READ, UPDATE], { rules: [[NOTE, 'hidden']] });
    const reader = grant([READ], { rules: [[NATIONAL_ID, 'read']] });
    expect(modesOf([narrow, reader])).toEqual({
      [NAME]: 'edit',
      [NOTE]: 'read',
      [NATIONAL_ID]: 'read',
    });
  });

  it('ignores a grant whose qualifier does not cover the definition', () => {
    const elsewhere = grant([READ, UPDATE], { qualifier: only(OTHER_DEFINITION) });
    const access = FieldPolicy.evaluate([elsewhere], request());
    expect(access).toMatchObject({ canRead: false, canWrite: false });
    expect([...access.modes.values()]).toEqual(['hidden', 'hidden', 'hidden']);
  });

  it('ignores a qualified key held without a qualifier: it covers no definition', () => {
    const bare: FieldGrant = { ...grant([READ]), qualifiers: new Map() };
    expect(FieldPolicy.evaluate([bare], request()).canRead).toBe(false);
  });

  it('lets a process step narrow, never widen (decision 8)', () => {
    const step = new Map<Id<'Field'>, FieldMode>([
      [NAME, 'read'],
      [NATIONAL_ID, 'edit'],
    ]);
    expect(modesOf([grant([READ, UPDATE])], { step })).toEqual({
      [NAME]: 'read',
      [NOTE]: 'edit',
      [NATIONAL_ID]: 'hidden',
    });
  });

  it('answers no access to an actor without grants', () => {
    expect(FieldPolicy.evaluate([], request())).toMatchObject({ canRead: false, canWrite: false });
  });
});

describe('FieldPolicy.forPortal', () => {
  it('uses the per-field portal setting, hidden by default, narrowed by the step', () => {
    expect(Object.fromEntries(FieldPolicy.forPortal(FIELDS))).toEqual({
      [NAME]: 'read',
      [NOTE]: 'hidden',
      [NATIONAL_ID]: 'edit',
    });
    const step = new Map<Id<'Field'>, FieldMode>([[NATIONAL_ID, 'read']]);
    expect(FieldPolicy.forPortal(FIELDS, step).get(NATIONAL_ID)).toBe('read');
  });
});

describe('FieldPolicy.project and checkWrite', () => {
  const modes = new Map<Id<'Field'>, FieldMode>([
    [NAME, 'edit'],
    [NOTE, 'read'],
    [NATIONAL_ID, 'hidden'],
  ]);

  it('leaves hidden and unknown fields out of a read, not nulled', () => {
    const projected = FieldPolicy.project(
      { [NAME]: 'Sara', [NOTE]: 'n', [NATIONAL_ID]: '0012345678', [id(9)]: 'x' },
      { canRead: true, modes },
    );
    expect(projected).toEqual({ [NAME]: 'Sara', [NOTE]: 'n' });
    expect(Object.hasOwn(projected, NATIONAL_ID)).toBe(false);
  });

  it('shows nothing without the read operation, whatever the modes (review M1)', () => {
    expect(FieldPolicy.project({ [NAME]: 'Sara' }, { canRead: false, modes })).toEqual({});
    for (const write of [UPDATE, CREATE]) {
      const access = FieldPolicy.evaluate(
        [grant([write])],
        request({ operations: { read: READ, write } }),
      );
      expect(access.canRead).toBe(false);
      expect(FieldPolicy.project({ [NAME]: 'Sara', [NOTE]: 'n' }, access)).toEqual({});
      expect(FieldPolicy.checkWrite([NAME], access.modes).ok).toBe(true);
    }
  });

  it('refuses a write naming a field that is not edit, whatever its value, naming no field', () => {
    expect(FieldPolicy.checkWrite([NAME], modes)).toEqual({ ok: true, value: undefined });
    for (const field of [NOTE, NATIONAL_ID, id<'Field'>(9)]) {
      expect(FieldPolicy.checkWrite([NAME, field], modes)).toEqual({
        ok: false,
        error: { code: 'access.field-denied' },
      });
    }
  });
});

class Rules implements FieldRuleReader {
  readonly asked: [string, Id<'Definition'>][] = [];
  constructor(private readonly grants: readonly FieldGrant[]) {}
  grantsFor(context: CallContext, definitionId: Id<'Definition'>) {
    this.asked.push([context.tenant.tenantId, definitionId]);
    return Promise.resolve(this.grants);
  }
}

/** CHILD_SITE is below SITE; nothing else is related. */
const tree: SiteAncestryReader = {
  siteExists: () => Promise.resolve(true),
  isWithinSubtree: (_c, siteId, root) => Promise.resolve(siteId === CHILD_SITE && root === SITE),
};

describe.each(TEST_TENANTS)('resolveFieldAccess in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const actor = (population: 'tenant-staff' | 'portal-user' | 'platform-operator') =>
    testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population,
        accountId: id<'Account'>(7),
        sessionId: id<'Session'>(8),
      }),
    );
  const staff = actor('tenant-staff');

  it("reads the actor's grants in its tenant and keeps those covering the record's site", async () => {
    const rules = new Rules([
      grant([READ], { scope: { level: 'site', siteId: SITE, includeDescendants: true } }),
      grant([READ, UPDATE], { scope: { level: 'site', siteId: SITE, includeDescendants: false } }),
    ]);
    const access = await resolveFieldAccess(rules, tree, staff, CHILD_SITE, request());
    expect(rules.asked).toEqual([[code, DEFINITION]]);
    expect(access).toMatchObject({ canRead: true, canWrite: false });
    expect(access.modes.get(NAME)).toBe('read');
  });

  it('lets only tenant grants cover a tenant-level record', async () => {
    const siteGrant = grant([READ], {
      scope: { level: 'site', siteId: SITE, includeDescendants: true },
    });
    const none = await resolveFieldAccess(new Rules([siteGrant]), tree, staff, null, request());
    expect(none.canRead).toBe(false);
    const tenantWide = await resolveFieldAccess(
      new Rules([grant([READ])]),
      tree,
      staff,
      null,
      request(),
    );
    expect(tenantWide.canRead).toBe(true);
  });

  it.each([
    ['a portal user', actor('portal-user')],
    ['a platform operator', actor('platform-operator')],
    ['the anonymous actor', testCallContext(tenant, 'anonymous')],
    ['the system actor', testCallContext(tenant, 'system')],
  ])('gives %s no access and never asks the reader', async (_who, context) => {
    const rules = new Rules([grant([READ, UPDATE])]);
    const access = await resolveFieldAccess(rules, tree, context, SITE, request());
    expect(access.canRead).toBe(false);
    expect([...access.modes.values()]).toEqual(['hidden', 'hidden', 'hidden']);
    expect(rules.asked).toEqual([]);
  });

  it('under the fail-closed placeholders, every field is hidden', async () => {
    const access = await resolveFieldAccess(
      new FailClosedFieldRuleReader(),
      new FailClosedSiteAncestryReader(),
      staff,
      SITE,
      request(),
    );
    expect(access.canRead).toBe(false);
    expect([...access.modes.values()]).toEqual(['hidden', 'hidden', 'hidden']);
  });

  it('throws when the reader throws: an unanswered question is never access', async () => {
    const broken: FieldRuleReader = { grantsFor: () => Promise.reject(new Error('down')) };
    await expect(resolveFieldAccess(broken, tree, staff, SITE, request())).rejects.toThrow('down');
  });
});
