// SPIKE (PoC 2): ported from Mondapac platform/authz/access-rule.ts (Mondapac ADR-0018
// decision 4; Phoenix ADR-0004 decision 4), without the seller states.
import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

/** `<module>.<resource>.<action>`, given by `definePermission` only. */
export type PermissionKey = string & { readonly __brand: 'PermissionKey' };

export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/;

export function definePermission(key: string): PermissionKey {
  if (!PERMISSION_KEY_PATTERN.test(key)) throw new TypeError(`invalid permission key ${key}`);
  return key as PermissionKey;
}

/**
 * The closed set of rule kinds, one per use case:
 * - `anonymous`: no authentication; the body always gets the tenant's anonymous actor;
 * - `own-resources`: an authenticated actor, on what its own account owns;
 * - `system`: the system actor only (jobs, event handlers); never from HTTP;
 * - `permissions`: an authenticated actor holding every listed key.
 */
export type AccessRule =
  | { readonly kind: 'permissions'; readonly allOf: readonly [PermissionKey, ...PermissionKey[]] }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'own-resources' }
  | { readonly kind: 'system' };

export const ACCESS_RULE_KINDS = ['permissions', 'anonymous', 'own-resources', 'system'] as const;

/** The static declaration of a use case: an own property `access` of the concrete class. */
export interface AccessDeclaration {
  /** `<module>.<use-case>`, unique; used in denial logs. */
  readonly name: string;
  readonly rule: AccessRule;
}

export const USE_CASE_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type DeclarationProblem =
  | 'declaration-missing'
  | 'declaration-not-an-object'
  | 'declaration-unknown-field'
  | 'name-invalid'
  | 'rule-not-an-object'
  | 'rule-kind-unknown'
  | 'rule-unknown-field'
  | 'keys-missing'
  | 'key-invalid'
  | 'key-duplicate';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkRule(rule: unknown): DeclarationProblem | null {
  if (!isRecord(rule)) return 'rule-not-an-object';
  if (!(ACCESS_RULE_KINDS as readonly unknown[]).includes(rule.kind)) return 'rule-kind-unknown';
  const fields = Object.keys(rule).filter((field) => field !== 'kind');
  if (rule.kind !== 'permissions') return fields.length === 0 ? null : 'rule-unknown-field';
  if (fields.some((field) => field !== 'allOf')) return 'rule-unknown-field';
  const keys = rule.allOf;
  if (!Array.isArray(keys) || keys.length === 0) return 'keys-missing';
  if (keys.some((key) => typeof key !== 'string' || !PERMISSION_KEY_PATTERN.test(key))) {
    return 'key-invalid';
  }
  return new Set(keys).size === keys.length ? null : 'key-duplicate';
}

export function checkAccessDeclaration(
  value: unknown,
): Result<AccessDeclaration, { readonly code: DeclarationProblem }> {
  if (value === undefined) return err({ code: 'declaration-missing' });
  if (!isRecord(value)) return err({ code: 'declaration-not-an-object' });
  if (Object.keys(value).some((field) => field !== 'name' && field !== 'rule')) {
    return err({ code: 'declaration-unknown-field' });
  }
  if (typeof value.name !== 'string' || !USE_CASE_NAME_PATTERN.test(value.name)) {
    return err({ code: 'name-invalid' });
  }
  const problem = checkRule(value.rule);
  return problem === null ? ok(value as unknown as AccessDeclaration) : err({ code: problem });
}

/** The declaration of a use-case class, read only as its own property (never inherited). */
export function accessDeclarationOf(
  useCase: unknown,
): Result<AccessDeclaration, { readonly code: DeclarationProblem }> {
  if (typeof useCase !== 'function' || !Object.hasOwn(useCase, 'access')) {
    return err({ code: 'declaration-missing' });
  }
  return checkAccessDeclaration((useCase as { access?: unknown }).access);
}
