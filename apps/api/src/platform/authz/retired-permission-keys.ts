// Ported from Mondapac apps/api/src/platform/authz/retired-permission-keys.ts; Phoenix starts
// with an empty list.

/**
 * The checked-in list of retired permission keys. A key removed from a module's
 * `contracts/permissions.ts` is added here, and declaring a retired key again fails: otherwise
 * roles that still hold the old key would gain a new permission without an explicit edit. The
 * use-case CI check and the permission registry both refuse a retired key. Entries are never
 * removed.
 */
export const RETIRED_PERMISSION_KEYS: readonly string[] = Object.freeze([]);
