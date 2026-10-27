import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { invalid, type InvalidValue } from './values';

// The fields of a form revision (ADR-0024): one per top-level property of its JSON Schema,
// each with a stable id. Field rules, projections and the stored answers key on the id, never
// on the property name, so renaming a property keeps its rules and its answers.

/** What a portal user may do with a field of their own submission (ADR-0024 decision 9). */
export const PORTAL_MODES = ['hidden', 'read', 'edit'] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/** The most fields one revision may have (also the longest list an audit value holds). */
export const MAX_FIELDS = 256;

export interface FormField {
  /** UUIDv7, minted when the field first appears; kept across revisions and renames. */
  readonly id: Id<'Field'>;
  /** The JSON Schema property name in this revision. */
  readonly name: string;
  /**
   * Hidden from staff until a role's field rule opens it (ADR-0024 decision 4). Answers are
   * personal data encrypted under a subject key, so a field is sensitive unless the designer
   * says otherwise when it first appears; lowering it later needs the protected key
   * `forms.forms.lower-sensitivity`.
   */
  readonly sensitive: boolean;
  /** Absent: hidden from the portal user (ADR-0024 decision 9). */
  readonly portal?: Exclude<PortalMode, 'hidden'>;
}

/** The designer's settings of one field, by property name; every member optional. */
export interface FieldSettingInput {
  /** The id of a field of the previous revision: keeps it under a new name (a rename). */
  readonly id?: Id<'Field'>;
  readonly sensitive?: boolean;
  readonly portal?: string;
}

export interface AssignedFields {
  readonly fields: readonly FormField[];
  /** Fields that were sensitive in the previous revision and are not any more. */
  readonly lowered: readonly Id<'Field'>[];
}

/**
 * The fields of a new revision with properties `names` (in schema order), given the previous
 * revision's fields (`null` for the first revision, or one saved before field ids existed):
 *
 * 1. a setting's `id` must name a field of the previous revision, and names it for that
 *    property only (a rename);
 * 2. any other property takes the id its name had in the previous revision, unless step 1
 *    gave that id to another property;
 * 3. every other property gets a new id from `mint`.
 *
 * `sensitive` and `portal` follow the setting, else the previous field, else sensitive and
 * hidden. Settings for a name that is not a property are refused.
 */
export function assignFields(
  names: readonly string[],
  previous: readonly FormField[] | null,
  settings: Readonly<Record<string, FieldSettingInput>>,
  mint: () => Id<'Field'>,
): Result<AssignedFields, InvalidValue> {
  if (names.length > MAX_FIELDS) return invalid('fields');
  const properties = new Set(names);
  if (Object.keys(settings).some((name) => !properties.has(name))) return invalid('fields');
  const before = previous ?? [];
  const byId = new Map(before.map((field) => [field.id as string, field]));
  const byName = new Map(before.map((field) => [field.name, field]));

  const claimed = new Map<string, string>();
  for (const name of names) {
    const id = settings[name]?.id;
    if (id === undefined) continue;
    if (!byId.has(id) || claimed.has(id)) return invalid('fields');
    claimed.set(id, name);
  }

  const fields: FormField[] = [];
  const lowered: Id<'Field'>[] = [];
  for (const name of names) {
    const setting = settings[name] ?? {};
    let prior: FormField | undefined;
    if (setting.id !== undefined) prior = byId.get(setting.id);
    else {
      const sameName = byName.get(name);
      if (sameName !== undefined && !claimed.has(sameName.id)) prior = sameName;
    }
    const portal = parsePortal(setting.portal, prior?.portal);
    if (!portal.ok) return portal;
    if (setting.sensitive !== undefined && typeof setting.sensitive !== 'boolean') {
      return invalid('fields');
    }
    const sensitive = setting.sensitive ?? prior?.sensitive ?? true;
    const id = prior?.id ?? mint();
    if (prior?.sensitive === true && !sensitive) lowered.push(id);
    fields.push(
      portal.value === 'hidden'
        ? { id, name, sensitive }
        : { id, name, sensitive, portal: portal.value },
    );
  }
  return ok({ fields, lowered });
}

function parsePortal(
  value: string | undefined,
  prior: FormField['portal'],
): Result<PortalMode, InvalidValue> {
  if (value === undefined) return ok(prior ?? 'hidden');
  return (PORTAL_MODES as readonly string[]).includes(value)
    ? ok(value as PortalMode)
    : err({ code: 'forms.value.invalid', field: 'fields' });
}

/**
 * Reads a stored field list back; `null` for a revision saved before field ids existed, or a
 * list that does not have the stored shape (never trusted as fields).
 */
export function fieldsOf(stored: unknown): readonly FormField[] | null {
  if (!Array.isArray(stored)) return null;
  const fields: FormField[] = [];
  for (const item of stored as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, name, sensitive, portal } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof sensitive !== 'boolean') {
      return null;
    }
    if (portal !== undefined && portal !== 'read' && portal !== 'edit') return null;
    fields.push(
      portal === undefined
        ? { id: id as Id<'Field'>, name, sensitive }
        : { id: id as Id<'Field'>, name, sensitive, portal },
    );
  }
  return fields;
}
