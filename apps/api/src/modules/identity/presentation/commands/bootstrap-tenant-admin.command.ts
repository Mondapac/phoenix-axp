import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import type {
  CommandContext,
  OperatorCommandDefinition,
} from '../../../../platform/commands/command-registry';
import type { BootstrapTenantAdministrator } from '../../application/use-cases/bootstrap-tenant-administrator.use-case';

/** The exit codes of `identity.bootstrap-tenant-admin`. */
export const BOOTSTRAP_TENANT_ADMIN_EXIT = Object.freeze({
  /** The account now holds the tenant's system role. */
  granted: 0,
  /** Refused: usage, an invalid username, an existing administrator, a disabled account. */
  refused: 1,
  /**
   * Not granted yet: the person signs in (`sign-in-needed`), or the operator confirms the
   * account with the person (`confirm-needed`), then runs again with `--account <id>`.
   */
  pending: 2,
});

/**
 * `run-command identity.bootstrap-tenant-admin --tenant <id> --username <name> [--account <id>]`
 * (owner card of
 * slice 1.6, 2026-10-27): the tenant's first administrator, through the
 * `BootstrapTenantAdministrator` use case. Prints one JSON line with the outcome or the
 * refusal code and the account id; never the username.
 */
export function bootstrapTenantAdminCommand(
  bootstrap: BootstrapTenantAdministrator,
): OperatorCommandDefinition {
  return {
    name: 'identity.bootstrap-tenant-admin',
    usage: '--username <name> [--account <id>]',
    async run(
      context: CommandContext,
      argv: readonly string[],
      write: (line: string) => void,
    ): Promise<number> {
      const parsed = parseArguments(argv);
      if (parsed === null) {
        write(
          'usage: run-command identity.bootstrap-tenant-admin --tenant <id> --username <name> [--account <id>]',
        );
        return BOOTSTRAP_TENANT_ADMIN_EXIT.refused;
      }
      const result = await bootstrap.execute(context, parsed);
      if (!result.ok) {
        write(JSON.stringify({ outcome: 'refused', code: result.error.code }));
        return BOOTSTRAP_TENANT_ADMIN_EXIT.refused;
      }
      write(JSON.stringify(result.value));
      return result.value.outcome === 'granted'
        ? BOOTSTRAP_TENANT_ADMIN_EXIT.granted
        : BOOTSTRAP_TENANT_ADMIN_EXIT.pending;
    },
  };
}

/** Exactly `--username <name>`, then optionally `--account <id>` with a well-formed id. */
function parseArguments(
  argv: readonly string[],
): { username: string; accountId?: Id<'Account'> } | null {
  const [flag, username, accountFlag, accountText, ...rest] = argv;
  if (flag !== '--username' || username === undefined || rest.length > 0) return null;
  if (accountFlag === undefined) return { username };
  if (accountFlag !== '--account' || accountText === undefined) return null;
  const accountId = parseId<'Account'>(accountText);
  return accountId.ok ? { username, accountId: accountId.value } : null;
}
