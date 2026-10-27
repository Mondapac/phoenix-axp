import { describeAuditAction } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { FORMS_AUDIT_ACTIONS } from './audit-actions';
import { checkDataSchemaShape, checkUiSchema, type JsonObject } from './form-schema';
import {
  DEFAULT_RETENTION,
  parseRetention,
  parseSubmissionPolicy,
  retentionDaysOf,
  retentionOf,
} from './form-settings';
import { planPublish, planRetire } from './lifecycle';
import { parseFormKey, parseName } from './values';

const ROLE_A = '01890a5d-ac96-774b-bcce-b302099a8057' as Id<'Role'>;
const ROLE_B = '01890a5d-ac96-774b-bcce-b302099a8058' as Id<'Role'>;
const REVISION_1 = '01890a5d-ac96-774b-bcce-b302099a8061' as Id<'FormRevision'>;
const REVISION_2 = '01890a5d-ac96-774b-bcce-b302099a8062' as Id<'FormRevision'>;

describe('forms values', () => {
  it.each(['visit-request', 'a', 'x'.repeat(64)])('accepts the key %s', (key) => {
    expect(parseFormKey(key)).toEqual({ ok: true, value: key });
  });

  it.each(['', 'Visit', 'visit_request', '-a', 'a-', 'a--b', 'درخواست', 'x'.repeat(65)])(
    'refuses the key "%s"',
    (key) => {
      expect(parseFormKey(key)).toEqual({
        ok: false,
        error: { code: 'forms.value.invalid', field: 'key' },
      });
    },
  );

  it('trims a name and refuses an empty, overlong or control-character one', () => {
    expect(parseName('  درخواست ملاقات ')).toEqual({ ok: true, value: 'درخواست ملاقات' });
    for (const name of ['', '   ', 'x'.repeat(201), 'a\u0000b', 'a\nb']) {
      expect(parseName(name).ok).toBe(false);
    }
  });
});

describe('the submission policy', () => {
  it.each(['anyone', 'portal-user', 'staff'] as const)('accepts %s without roles', (audience) => {
    expect(parseSubmissionPolicy({ audience, roleIds: [], allowOnBehalf: true })).toEqual({
      ok: true,
      value: { audience, roleIds: [], allowOnBehalf: true },
    });
  });

  it('needs roles exactly for staff-roles, without repeats and at most 32', () => {
    const policy = (audience: string, roleIds: Id<'Role'>[]) =>
      parseSubmissionPolicy({ audience, roleIds, allowOnBehalf: false });
    expect(policy('staff-roles', [ROLE_A, ROLE_B]).ok).toBe(true);
    const roleIds = { ok: false, error: { code: 'forms.value.invalid', field: 'roleIds' } };
    expect(policy('staff-roles', [])).toEqual(roleIds);
    expect(policy('staff-roles', [ROLE_A, ROLE_A])).toEqual(roleIds);
    expect(policy('staff', [ROLE_A])).toEqual(roleIds);
    const many = Array.from(
      { length: 33 },
      (_, i) => `${ROLE_A.slice(0, -2)}${i + 10}` as Id<'Role'>,
    );
    expect(policy('staff-roles', many)).toEqual(roleIds);
    expect(policy('everyone', [])).toEqual({
      ok: false,
      error: { code: 'forms.value.invalid', field: 'audience' },
    });
  });
});

describe('the retention of personal data (D5)', () => {
  it('keeps forever by default and stores it as null', () => {
    expect(DEFAULT_RETENTION).toEqual({ kind: 'forever' });
    expect(parseRetention({ kind: 'forever' })).toEqual({ ok: true, value: DEFAULT_RETENTION });
    expect(retentionDaysOf(DEFAULT_RETENTION)).toBeNull();
    expect(retentionOf(null)).toEqual(DEFAULT_RETENTION);
  });

  it('takes a fixed period of 1 to 36 500 days', () => {
    expect(parseRetention({ kind: 'fixed', days: 365 })).toEqual({
      ok: true,
      value: { kind: 'fixed', days: 365 },
    });
    expect(retentionOf(30)).toEqual({ kind: 'fixed', days: 30 });
    for (const days of [undefined, 0, -1, 1.5, 36_501]) {
      expect(parseRetention({ kind: 'fixed', ...(days === undefined ? {} : { days }) })).toEqual({
        ok: false,
        error: { code: 'forms.value.invalid', field: 'retention.days' },
      });
    }
    expect(parseRetention({ kind: 'forever', days: 3 }).ok).toBe(false);
    expect(parseRetention({ kind: 'month' }).ok).toBe(false);
  });
});

describe('the life of a form', () => {
  const draft = { status: 'draft', publishedRevisionId: null } as const;

  it('publishes any revision but the one it serves, and brings a retired form back', () => {
    const published = planPublish(draft, REVISION_1);
    expect(published).toEqual({
      ok: true,
      value: { status: 'published', publishedRevisionId: REVISION_1 },
    });
    const state = { status: 'published', publishedRevisionId: REVISION_1 } as const;
    expect(planPublish(state, REVISION_1)).toEqual({
      ok: false,
      error: { code: 'forms.form.already-published' },
    });
    expect(planPublish(state, REVISION_2).ok).toBe(true);
    const retired = { status: 'retired', publishedRevisionId: REVISION_1 } as const;
    expect(planPublish(retired, REVISION_1)).toEqual({
      ok: true,
      value: { status: 'published', publishedRevisionId: REVISION_1 },
    });
  });

  it('retires a published form only, keeping its revision', () => {
    expect(planRetire({ status: 'published', publishedRevisionId: REVISION_2 })).toEqual({
      ok: true,
      value: { status: 'retired', publishedRevisionId: REVISION_2 },
    });
    for (const state of [draft, { status: 'retired', publishedRevisionId: REVISION_2 } as const]) {
      expect(planRetire(state)).toEqual({ ok: false, error: { code: 'forms.form.not-published' } });
    }
  });
});

describe('the shape of a revision', () => {
  const properties = {
    fullName: { type: 'string' },
    address: { type: 'object', properties: { 'city/town': { type: 'string' } } },
  };
  const data: JsonObject = {
    type: 'object',
    properties,
    definitions: { phone: { type: 'string' } },
  };

  it('accepts an object schema with references inside the document', () => {
    const schema = {
      ...data,
      properties: { ...properties, phone: { $ref: '#/definitions/phone' } },
    };
    expect(checkDataSchemaShape(schema)).toEqual({ ok: true, value: schema });
  });

  it('refuses a non-object root, a remote $ref and $async, naming where', () => {
    expect(checkDataSchemaShape([])).toMatchObject({ error: { problem: 'not-an-object' } });
    expect(checkDataSchemaShape({ type: 'string' })).toMatchObject({
      error: { field: 'jsonSchema', problem: 'root-not-object' },
    });
    expect(
      checkDataSchemaShape({
        type: 'object',
        properties: { a: { $ref: 'https://example.org/s.json' } },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'forms.schema.invalid',
        field: 'jsonSchema',
        problem: 'external-ref',
        pointer: '/properties/a/$ref',
      },
    });
    expect(checkDataSchemaShape({ ...data, $async: true })).toMatchObject({
      error: { problem: 'async-schema', pointer: '/$async' },
    });
  });

  it('resolves every element scope of the layout, escaped segments included', () => {
    const ui = {
      type: 'VerticalLayout',
      elements: [
        { type: 'Control', scope: '#/properties/fullName' },
        {
          type: 'Group',
          label: 'نشانی',
          elements: [{ type: 'Control', scope: '#/properties/address/properties/city~1town' }],
        },
      ],
    };
    expect(checkUiSchema(ui, data)).toEqual({ ok: true, value: ui });
  });

  it('refuses an unresolved scope and a malformed element, naming where', () => {
    const missing = {
      type: 'VerticalLayout',
      elements: [{ type: 'Control', scope: '#/properties/missing' }],
    };
    expect(checkUiSchema(missing, data)).toEqual({
      ok: false,
      error: {
        code: 'forms.schema.invalid',
        field: 'uiSchema',
        problem: 'scope-unresolved',
        pointer: '/elements/0/scope',
      },
    });
    expect(checkUiSchema({ type: 'Control', scope: '#/definitions/phone' }, data)).toMatchObject({
      error: { problem: 'scope-unresolved', pointer: '/scope' },
    });
    expect(checkUiSchema({ type: 'VerticalLayout', elements: [{}] }, data)).toMatchObject({
      error: { problem: 'element-malformed', pointer: '/elements/0' },
    });
    expect(checkUiSchema({ type: 'VerticalLayout', elements: {} }, data)).toMatchObject({
      error: { problem: 'element-malformed', pointer: '/elements' },
    });
    expect(checkUiSchema('layout', data)).toMatchObject({ error: { problem: 'not-an-object' } });
  });
});

describe('the audit actions of the forms module', () => {
  it('describe every action with closed fields only', () => {
    expect(FORMS_AUDIT_ACTIONS.map((definition) => describeAuditAction(definition).action)).toEqual(
      [
        'forms.form.created',
        'forms.form.updated',
        'forms.form-revision.saved',
        'forms.form.published',
        'forms.form.retired',
        'forms.form-revision.sensitivity-lowered',
        'forms.submission.received',
        'forms.submission.erased',
      ],
    );
  });
});
