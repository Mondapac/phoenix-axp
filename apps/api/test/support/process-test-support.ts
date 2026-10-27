import { encodeAuditFields } from '@phoenix/shared-kernel';
import type { AuditEntry, CallContext } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { PROCESS_AUDIT_ACTIONS } from '../../src/modules/process/domain/audit-actions';
import { TEST_TENANT_CONFIG_DIRS, TEST_TENANTS, testTenantId } from './test-config';

// Shared by the process module's database suites: an audit writer that checks every entry
// against the module's catalogue and keeps it, and the registry of the two test tenants (their
// time zones count the deadlines).

const DEFINITIONS = new Map(PROCESS_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

export class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(context: CallContext, entry: AuditEntry): Promise<void> {
    const definition = DEFINITIONS.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
    if (!(definition.actors as readonly string[]).includes(context.actor.kind)) {
      throw new Error(`${entry.action} is not declared for a ${context.actor.kind} actor`);
    }
    const options = { isKnownPermissionKey: () => false };
    if (
      definition.after !== null &&
      !encodeAuditFields(definition.after, entry.after, options).ok
    ) {
      throw new Error(`${entry.action}: the after values do not match the catalogue`);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export const testTenantRegistry = (): TenantRegistry =>
  new TenantRegistry(loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)));
