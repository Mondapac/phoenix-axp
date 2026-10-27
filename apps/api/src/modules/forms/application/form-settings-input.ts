import { ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import {
  DEFAULT_RETENTION,
  parseRetention,
  parseSubmissionPolicy,
  retentionDaysOf,
  type Retention,
  type SubmissionPolicy,
} from '../domain/form-settings';
import type { InvalidValue } from '../domain/values';

/** The settings of a form as a caller sends them. */
export interface FormSettingsInput {
  readonly policy: {
    readonly audience: string;
    readonly roleIds: readonly Id<'Role'>[];
    readonly allowOnBehalf: boolean;
  };
  /** Absent: keep forever (D5). */
  readonly retention?: { readonly kind: string; readonly days?: number };
}

export function parseSettings(
  input: FormSettingsInput,
): Result<{ policy: SubmissionPolicy; retention: Retention }, InvalidValue> {
  const policy = parseSubmissionPolicy(input.policy);
  if (!policy.ok) return policy;
  const retention =
    input.retention === undefined ? ok(DEFAULT_RETENTION) : parseRetention(input.retention);
  if (!retention.ok) return retention;
  return ok({ policy: policy.value, retention: retention.value });
}

/** The audit fields of a form's settings. */
export const settingsAudit = (policy: SubmissionPolicy, retention: Retention) => ({
  audience: policy.audience,
  roleIds: policy.roleIds,
  allowOnBehalf: policy.allowOnBehalf,
  retentionDays: retentionDaysOf(retention),
});
