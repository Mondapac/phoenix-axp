import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import {
  ACCOUNT_DISABLED_BY_DIRECTORY,
  ACCOUNT_ENABLED_BY_DIRECTORY,
  DIRECTORY_SYNC_RAN,
} from '../domain/audit-actions';
import {
  isSyncDue,
  shouldHalt,
  syncChangeOf,
  type DirectoryStatus,
  type SyncOutcome,
} from '../domain/directory-sync';
import type { AccountRepository, DirectoryAccount } from './account.repository';
import type { DirectorySyncRepository } from './directory-sync.repository';
import type { SessionRepository } from './session.repository';
import type { StaffDirectory } from './staff-directory';

/** Accounts read per unit, asked about per directory call, and changed per unit. */
const READ_BATCH = 500;
const ASK_BATCH = 100;
const APPLY_BATCH = 50;

export interface SyncSummary {
  /** `skipped`: not due yet, or another run holds this one. */
  readonly outcome: SyncOutcome | 'skipped';
  readonly accountsChecked: number;
  readonly accountsDisabled: number;
  readonly accountsEnabled: number;
}

const SKIPPED: SyncSummary = Object.freeze({
  outcome: 'skipped',
  accountsChecked: 0,
  accountsDisabled: 0,
  accountsEnabled: 0,
});

/**
 * One run of the staff directory sync of a tenant (ADR-0022 decision 6), shared by the
 * scheduled `system` use case and the studio's "sync now". Safe to run twice and to overlap:
 * a run claims the tenant's row first (a run that loses the claim does nothing), every change
 * is conditional on the account's version, and nothing changes before the directory has
 * answered for every account. HTTP to the directory happens between units, never inside one.
 */
export class DirectorySyncRunner {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly syncs: DirectorySyncRepository,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly directory: StaffDirectory,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  /** `scheduled` runs only when due; `requested` ("sync now") runs whenever it can claim. */
  async run(context: CallContext, mode: 'scheduled' | 'requested'): Promise<SyncSummary> {
    const { tenant } = context;
    const claimed = await this.unitOfWork.run<{ previous: SyncOutcome | null } | null, never>(
      tenant,
      async () => {
        const now = this.clock.now();
        const state = await this.syncs.read(tenant);
        if (mode === 'scheduled' && !isSyncDue(state.lastStartedAt, state.intervalMinutes, now)) {
          return ok(null);
        }
        const won = await this.syncs.claim(tenant, state.lastStartedAt, now);
        return ok(won ? { previous: state.lastOutcome } : null);
      },
    );
    if (!claimed.ok || claimed.value === null) return SKIPPED;
    const { previous } = claimed.value;

    const accounts = await this.readAll(context);
    const statuses = new Map<string, DirectoryStatus>();
    for (let at = 0; at < accounts.length; at += ASK_BATCH) {
      const batch = accounts.slice(at, at + ASK_BATCH);
      const answer = await this.directory.statusOf(
        tenant,
        batch.map((account) => account.subject),
      );
      if (!answer.ok) return this.finish(context, previous, 'failed', accounts.length, 0, 0);
      for (const [subject, status] of answer.value) statuses.set(subject, status);
    }

    const changes = accounts.flatMap((account) => {
      const status = statuses.get(account.subject);
      // A subject the directory did not answer for is left alone: never disable on silence.
      if (status === undefined) return [];
      const change = syncChangeOf(account.status, status);
      return change === 'none' ? [] : [{ account, change }];
    });
    const toDisable = changes.filter((c) => c.change === 'disable').length;
    if (shouldHalt(accounts.length, toDisable)) {
      return this.finish(context, previous, 'halted', accounts.length, 0, 0);
    }

    let disabled = 0;
    let enabled = 0;
    for (let at = 0; at < changes.length; at += APPLY_BATCH) {
      const applied = await this.unitOfWork.run(tenant, async () => {
        const now = this.clock.now();
        const done = { disabled: 0, enabled: 0 };
        for (const { account, change } of changes.slice(at, at + APPLY_BATCH)) {
          const status = change === 'disable' ? 'disabled' : 'active';
          if (
            !(await this.accounts.setStatusIfUnchanged(
              tenant,
              account.id,
              account.version,
              status,
              now,
            ))
          ) {
            continue;
          }
          if (change === 'disable') {
            const sessionsEnded = await this.sessions.endAllOf(tenant, account.id);
            await this.audit.record(
              context,
              ACCOUNT_DISABLED_BY_DIRECTORY.entry(account.id, { after: { sessionsEnded } }),
            );
            done.disabled += 1;
          } else {
            await this.audit.record(context, ACCOUNT_ENABLED_BY_DIRECTORY.entry(account.id, {}));
            done.enabled += 1;
          }
        }
        return ok(done);
      });
      if (applied.ok) {
        disabled += applied.value.disabled;
        enabled += applied.value.enabled;
      }
    }
    return this.finish(context, previous, 'completed', accounts.length, disabled, enabled);
  }

  private async readAll(context: CallContext): Promise<DirectoryAccount[]> {
    const { tenant } = context;
    const all: DirectoryAccount[] = [];
    for (;;) {
      const after = all.length === 0 ? null : all[all.length - 1]!.id;
      const page = await this.unitOfWork.run(
        tenant,
        async () => ok(await this.accounts.directoryAccounts(tenant, after, READ_BATCH)),
        { readOnly: true },
      );
      if (!page.ok) return all;
      all.push(...page.value);
      if (page.value.length < READ_BATCH) return all;
    }
  }

  private async finish(
    context: CallContext,
    previous: SyncOutcome | null,
    outcome: SyncOutcome,
    checked: number,
    disabled: number,
    enabled: number,
  ): Promise<SyncSummary> {
    const summary: SyncSummary = {
      outcome,
      accountsChecked: checked,
      accountsDisabled: disabled,
      accountsEnabled: enabled,
    };
    await this.unitOfWork.run<void, never>(context.tenant, async () => {
      await this.syncs.finish(
        context.tenant,
        outcome,
        { checked, disabled, enabled },
        this.clock.now(),
      );
      // Audited when it changed an account or its outcome differs from the last run's: a quiet
      // run, or the same failure again every interval, adds a row that says nothing new.
      if (outcome !== previous || disabled > 0 || enabled > 0) {
        await this.audit.record(
          context,
          DIRECTORY_SYNC_RAN.entry('tenant', {
            after: {
              outcome,
              accountsChecked: checked,
              accountsDisabled: disabled,
              accountsEnabled: enabled,
            },
          }),
        );
      }
      return ok(undefined);
    });
    return summary;
  }
}
