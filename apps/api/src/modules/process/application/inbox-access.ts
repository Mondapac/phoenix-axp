import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  grantCoversSite,
  type RoleHolding,
  type RoleHoldingReader,
  type SiteAncestryReader,
} from '../../../platform/authz';
import type { HoldingAtSite } from '../domain/task-access';
import { NO_TASK_SETTINGS, parseTaskSettings, type TaskSettings } from '../domain/task-settings';
import type { StoredTaskSettings } from './process.repository';

/**
 * An account's role holdings, each resolved against task sites (ADR-0025): read once per
 * request from identity, never from input, and asked of the site tree once per site. A
 * tenant-level task (no site) is covered by tenant grants only.
 */
export class HoldingsAtSites {
  readonly #bySite = new Map<string | null, Promise<HoldingAtSite[]>>();

  private constructor(
    private readonly context: CallContext,
    private readonly sites: SiteAncestryReader,
    readonly holdings: readonly RoleHolding[],
  ) {}

  static async of(
    context: CallContext,
    accountId: Id<'Account'>,
    reader: RoleHoldingReader,
    sites: SiteAncestryReader,
  ): Promise<HoldingsAtSites> {
    return new HoldingsAtSites(context, sites, await reader.holdingsOf(context, accountId));
  }

  /** The role ids held anywhere: the queues worth reading. */
  get roleIds(): Id<'Role'>[] {
    return [...new Set(this.holdings.map((holding) => holding.roleId))];
  }

  at(siteId: Id<'Site'> | null): Promise<HoldingAtSite[]> {
    let resolved = this.#bySite.get(siteId);
    if (resolved === undefined) {
      resolved = Promise.all(
        this.holdings.map(async (holding) => ({
          roleId: holding.roleId,
          keys: holding.keys,
          coversSite:
            siteId === null
              ? holding.scope.level === 'tenant'
              : await grantCoversSite(this.sites, this.context, holding.scope, siteId),
        })),
      );
      this.#bySite.set(siteId, resolved);
    }
    return resolved;
  }
}

/**
 * The settings of one user task of a revision, checked again as they are read (a stored row is
 * data, not trust). Settings that no longer pass give no queue and no deadline: the task waits
 * for a supervisor, which fails closed.
 */
export function settingsOf(stored: StoredTaskSettings | null, taskKey: string): TaskSettings {
  const attributes = stored?.[taskKey];
  if (attributes === undefined || typeof attributes !== 'object' || attributes === null) {
    return NO_TASK_SETTINGS;
  }
  const entries = Object.entries(attributes).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const parsed = parseTaskSettings(new Map(entries));
  return parsed.ok ? parsed.value : NO_TASK_SETTINGS;
}
