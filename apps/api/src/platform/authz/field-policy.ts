// Phoenix ADR-0024 (field-level access, owner decision D8): the one evaluator of field modes,
// the port it reads the actor's rules through, and the projection and write check every read
// and write path applies. No template file: Mondapac has no field-level access.
import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import type { PermissionKey } from './access-rule';
import { grantCoversDefinition, type DefinitionScopedGrant } from './definition-scope';
import type { GrantScope } from './roles/role-model';
import { grantCoversSite, type SiteAncestryReader } from './site-scope';

/** What a role may do with one field: not see it, see it, or see and change it. */
export const FIELD_MODES = ['hidden', 'read', 'edit'] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

const RANK: Readonly<Record<FieldMode, number>> = Object.freeze({ hidden: 0, read: 1, edit: 2 });

/** The narrower of two modes. */
export function narrowerMode(a: FieldMode, b: FieldMode): FieldMode {
  return RANK[a] <= RANK[b] ? a : b;
}

/** True when `mode` lets the actor see the field. */
export const isVisible = (mode: FieldMode | undefined): boolean =>
  mode === 'read' || mode === 'edit';

/** The refusal of a write that touches a field the actor may not edit. Names no field. */
export type FieldDenied = { readonly code: 'access.field-denied' };
export const FIELD_DENIED: FieldDenied = Object.freeze({ code: 'access.field-denied' });
export const FIELD_DENIED_STATUS: Readonly<Record<FieldDenied['code'], number>> = Object.freeze({
  'access.field-denied': 403,
});

/**
 * One field of a definition, as the caller passes it. `id` is the field's stable id (a
 * UUIDv7 minted when the field is added; renaming keeps it). `sensitive` is true when the
 * revision the record was written under OR the current revision marks the field (decision 5);
 * fields holding encrypted personal data are sensitive by default. `portal` is the
 * definition's per-field setting for portal users, hidden when absent (decision 9).
 */
export interface FieldDescriptor {
  readonly id: Id<'Field'>;
  readonly sensitive: boolean;
  readonly portal?: FieldMode;
}

/**
 * One role assignment of the actor, as the {@link FieldRuleReader} reads it: where it applies,
 * every key its role confers, the qualifier of each qualified key, and its role's field rules
 * for the definition asked.
 */
export interface FieldGrant extends DefinitionScopedGrant {
  readonly scope: GrantScope;
  readonly keys: ReadonlySet<string>;
  readonly fieldRules: ReadonlyMap<Id<'Field'>, FieldMode>;
}

/** The question: one definition revision, its operation keys and its fields. */
export interface FieldRequest {
  readonly definitionId: Id<'Definition'>;
  /**
   * The keys of the operations: `read` (for example `objects.record.read`) and `write`, the
   * update key, or the create key when the request creates a record.
   */
  readonly operations: { readonly read: PermissionKey; readonly write: PermissionKey };
  readonly fields: readonly FieldDescriptor[];
  /** A process step's narrowing (decision 8): the effective mode is the narrower. */
  readonly step?: ReadonlyMap<Id<'Field'>, FieldMode>;
}

/**
 * The answer: whether the actor may read or write records of the definition at all, and the
 * mode of every field it was asked about, kept apart per operation so that a field one grant
 * opens for writing never becomes readable through another grant's read (slice 2.8 fix).
 * `readModes` comes from the grants conferring the read key only and holds `read` or `hidden`;
 * `writeModes` comes from the grants conferring the write key only, and a field is writable
 * when it is `edit` there. A field id not in a map is hidden.
 */
export interface FieldAccess {
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly readModes: ReadonlyMap<Id<'Field'>, FieldMode>;
  readonly writeModes: ReadonlyMap<Id<'Field'>, FieldMode>;
}

const stepped = (
  modes: Map<Id<'Field'>, FieldMode>,
  step: ReadonlyMap<Id<'Field'>, FieldMode> | undefined,
): ReadonlyMap<Id<'Field'>, FieldMode> => {
  if (step === undefined) return modes;
  for (const [id, mode] of modes) modes.set(id, narrowerMode(mode, step.get(id) ?? 'edit'));
  return modes;
};

/**
 * `FieldPolicy`: a pure domain service. {@link evaluate} is the only computation of field modes
 * (ADR-0024 decision 4); {@link project} and {@link checkWrite} apply its answer. Generated REST
 * and GraphQL resolvers, exports, search projections and task forms call these, and no read
 * path builds its own projection.
 */
export const FieldPolicy = Object.freeze({
  /**
   * The field modes of an actor holding `grants`, every one of which already covers the
   * record's site (the caller filters with `grantCoversSite`; {@link resolveFieldAccess} does).
   * Each operation is evaluated on its own: a grant counts for an operation only when it confers
   * that operation's key and its qualifier covers the definition. Per counting grant, a field
   * takes the grant's rule, or without one follows the operation (write gives `edit`, read gives
   * `read`), except a sensitive field, which is `hidden` without a rule; and no field is wider
   * than the operation. The actor's mode per operation is the widest over the grants counting
   * for it, then narrowed by the step. Read and write never mix: a grant conferring only the
   * write key adds nothing to what is visible, and a read grant makes nothing writable.
   */
  evaluate(grants: readonly FieldGrant[], request: FieldRequest): FieldAccess {
    const { definitionId, operations, fields } = request;
    const widest = (key: PermissionKey, ceiling: FieldMode) => {
      let held = false;
      const modes = new Map<Id<'Field'>, FieldMode>(fields.map((field) => [field.id, 'hidden']));
      for (const grant of grants) {
        if (!grant.keys.has(key) || !grantCoversDefinition(grant, key, definitionId)) continue;
        held = true;
        for (const field of fields) {
          const base = grant.fieldRules.get(field.id) ?? (field.sensitive ? 'hidden' : ceiling);
          const mode = narrowerMode(base, ceiling);
          if (RANK[mode] > RANK[modes.get(field.id) ?? 'hidden']) modes.set(field.id, mode);
        }
      }
      return { held, modes: stepped(modes, request.step) };
    };
    const read = widest(operations.read, 'read');
    const write = widest(operations.write, 'edit');
    return {
      canRead: read.held,
      canWrite: write.held,
      readModes: read.modes,
      writeModes: write.modes,
    };
  },

  /**
   * The modes of a portal user, who holds no role (ADR-0019): the definition's per-field portal
   * setting, hidden when absent, narrowed by the step. Whether the portal user may read or
   * write the record at all is the use case's (`own-resources`) decision.
   */
  forPortal(
    fields: readonly FieldDescriptor[],
    step?: ReadonlyMap<Id<'Field'>, FieldMode>,
  ): ReadonlyMap<Id<'Field'>, FieldMode> {
    return stepped(new Map(fields.map((field) => [field.id, field.portal ?? 'hidden'])), step);
  },

  /**
   * A record's values, keyed by field id, without every field that is not visible: hidden
   * and unknown fields are left out, not nulled (decision 6). Without the read operation
   * nothing is visible, whatever the modes: an update-only or create-only actor writes fields
   * it cannot read back (security review of slice 2.0, M1). A portal read passes `canRead`
   * from its own-resources decision.
   */
  project(
    values: Readonly<Record<string, unknown>>,
    access: Pick<FieldAccess, 'canRead' | 'readModes'>,
  ): Record<string, unknown> {
    if (access.canRead !== true) return {};
    return Object.fromEntries(
      Object.entries(values).filter(([id]) => isVisible(access.readModes.get(id as Id<'Field'>))),
    );
  },

  /**
   * A write that names any field whose mode is not `edit` is refused, whatever its value
   * (decision 7); an unknown field id is hidden, so it is refused too. Staff writes pass
   * `FieldAccess.writeModes`; a portal write passes {@link forPortal}'s modes.
   */
  checkWrite(
    fieldIds: Iterable<string>,
    modes: ReadonlyMap<Id<'Field'>, FieldMode>,
  ): Result<void, FieldDenied> {
    for (const id of fieldIds) {
      if (modes.get(id as Id<'Field'>) !== 'edit') return err(FIELD_DENIED);
    }
    return ok(undefined);
  },
});

/**
 * The port identity implements (ADR-0024 decision 5): the actor's role assignments with their
 * qualifiers and their roles' field rules for one definition. It reads committed state in a
 * read-only unit of its own, for an active account with a live session, and caches nothing.
 * Until identity binds it, `AuthzModule` binds the fail-closed placeholder, which answers no
 * grant: every field is hidden.
 */
export interface FieldRuleReader {
  grantsFor(context: CallContext, definitionId: Id<'Definition'>): Promise<readonly FieldGrant[]>;
}

/** Nest token of the {@link FieldRuleReader}. */
export const FIELD_RULE_READER = Symbol('FIELD_RULE_READER');

const NO_ACCESS = (fields: readonly FieldDescriptor[]): FieldAccess => {
  const hidden = new Map<Id<'Field'>, FieldMode>(fields.map((field) => [field.id, 'hidden']));
  return { canRead: false, canWrite: false, readModes: hidden, writeModes: new Map(hidden) };
};

/**
 * The field access of the calling staff member on a record of `request.definitionId` owned by
 * `siteId` (`null` for a tenant-level record, which only tenant grants cover). Computed once
 * per request and definition revision; nothing is cached across requests. Any other actor
 * (portal user, anonymous, system, platform operator) gets no access: portal users go through
 * {@link FieldPolicy.forPortal}. A reader that throws makes this throw.
 */
export async function resolveFieldAccess(
  rules: FieldRuleReader,
  sites: SiteAncestryReader,
  context: CallContext,
  siteId: Id<'Site'> | null,
  request: FieldRequest,
): Promise<FieldAccess> {
  const { actor } = context;
  if (actor.kind !== 'authenticated' || actor.population !== 'tenant-staff') {
    return NO_ACCESS(request.fields);
  }
  const covering: FieldGrant[] = [];
  for (const grant of await rules.grantsFor(context, request.definitionId)) {
    const covers =
      siteId === null
        ? grant.scope.level === 'tenant'
        : await grantCoversSite(sites, context, grant.scope, siteId);
    if (covers) covering.push(grant);
  }
  return FieldPolicy.evaluate(covering, request);
}
