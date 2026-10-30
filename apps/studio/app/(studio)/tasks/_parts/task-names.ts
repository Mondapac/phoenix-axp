import { roleName, type Role, type StaffAccount } from '../../../_lib/people';
import { readForPage, type StudioSession } from '../../../_server/session';
import type { TaskNames } from './task-parts';

/** The names behind a task's ids, where the member may read them. */
export async function taskNames(session: StudioSession): Promise<TaskNames> {
  const { held, sites, t } = session;
  const [roles, accounts] = await Promise.all([
    held.has('identity.roles.view') ? readForPage<{ items: Role[] }>('identity/roles') : null,
    held.has('identity.accounts.view')
      ? readForPage<{ items: StaffAccount[] }>('identity/staff-accounts')
      : null,
  ]);
  return {
    sites: new Map(sites.map((site) => [site.id, site.name])),
    roles: new Map((roles?.items ?? []).map((role) => [role.id, roleName(t, role.key)])),
    people: new Map((accounts?.items ?? []).map((account) => [account.id, account.username])),
  };
}
