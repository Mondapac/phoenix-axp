import type { CallContext, TenantContext } from '@phoenix/shared-kernel';

/**
 * Collaborators the spike needs from modules that do not exist yet. Each becomes a facade of
 * its owning module: the approver chain from identity/organisation (Phase 1), the deadline from
 * tenant SLA settings (V2 effective-dated, ADR-0007).
 */
export interface ApproverDirectory {
  /** The requester's approver and the approver's manager, as account ids; null when none. */
  approversOf(
    context: CallContext,
    requesterId: string,
  ): Promise<{ readonly approverId: string; readonly managerId: string } | null>;
}

export interface ApprovalSettings {
  /** How long the approver has before the task escalates to the manager. */
  escalateAfterSeconds(tenant: TenantContext): number;
}

/** JSON Schema validation of a submission against its form revision. */
export interface FormValidator {
  /** The JSON pointers of the invalid fields; empty when the answers are valid. */
  invalidFields(jsonSchema: object, answers: unknown): readonly string[];
}

/** Hashing and deterministic ids; kept out of units of work (CLAUDE.md, persistence). */
export interface ContentHasher {
  /** SHA-256 of the canonical JSON (sorted keys) of `value`, hex. */
  hashOf(value: unknown): string;
  /**
   * A UUID-shaped id derived from `parts`: the event id of an engine observation, the same on
   * every poll, so the inbox sees a repeated observation as a duplicate.
   */
  derivedId(parts: readonly string[]): string;
}
