// From Mondapac apps/api/src/platform/events/outbox-writer.ts (`PermissionKeyLookup`,
// `PERMISSION_KEY_LOOKUP`). Phoenix keeps the port in platform/authz, which lands before the
// events and the audit that read it.

/**
 * Answers whether a permission key is known to the `PermissionRegistry` or its retired list,
 * for `permissionKey` fields of events and audit rows. The binding is the registry itself
 * (`AuthzModule`). Never an answer to "may this actor": that is the role model's.
 */
export interface PermissionKeyLookup {
  isKnownPermissionKey(key: string): boolean;
}

export const PERMISSION_KEY_LOOKUP = Symbol('PERMISSION_KEY_LOOKUP');

/** A lookup that knows no key: every `permissionKey` field is refused. Tests only. */
export const NO_PERMISSION_KEYS: PermissionKeyLookup = Object.freeze({
  isKnownPermissionKey: () => false,
});
