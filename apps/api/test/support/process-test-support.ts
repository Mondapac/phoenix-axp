import { randomUUID } from 'node:crypto';
import { encodeAuditFields, ok } from '@phoenix/shared-kernel';
import type { AuditEntry, CallContext, Id } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import type { FormReferences } from '../../src/modules/forms';
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

/**
 * A forms facade that finds every key published, with fresh ids: for suites whose models name
 * forms but are not about the form link (slice 2.6 has its own scenarios).
 */
export const ANY_FORMS: FormReferences = {
  published: (_context, keys) =>
    Promise.resolve(
      ok(
        keys.map((key) => ({
          key,
          formId: randomUUID() as Id<'Form'>,
          revisionId: randomUUID() as Id<'FormRevision'>,
        })),
      ),
    ),
};

/**
 * A decision table (slice 2.7) that routes on `days` and `kind` to the process variable `lane`:
 * `sick` over five days goes to `long`, anything else to `fallback` (each tenant fixture passes
 * its own value, so a run of one tenant's table in the other shows).
 */
export const decisionTable = (
  key: string,
  fallback = 'clerk',
) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs_${key}" name="Routing" namespace="http://phoenix.example/dmn">
  <decision id="${key}" name="Routing">
    <decisionTable id="table" hitPolicy="FIRST">
      <input id="i1" label="Days"><inputExpression id="ie1" typeRef="number"><text>days</text></inputExpression></input>
      <input id="i2" label="Kind"><inputExpression id="ie2" typeRef="string"><text>kind</text></inputExpression></input>
      <output id="o1" name="lane" typeRef="string"/>
      <rule id="r1">
        <inputEntry id="r1i1"><text>&gt; 5</text></inputEntry>
        <inputEntry id="r1i2"><text>"sick"</text></inputEntry>
        <outputEntry id="r1o1"><text>"long"</text></outputEntry>
      </rule>
      <rule id="r2">
        <inputEntry id="r2i1"><text>-</text></inputEntry>
        <inputEntry id="r2i2"><text></text></inputEntry>
        <outputEntry id="r2o1"><text>"${fallback}"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;

/** A process whose decision task runs `tableKey`, then waits in the user task its lane names. */
export const decisionProcess = (
  key: string,
  tableKey: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="route"/>
    <serviceTask id="route" name="Route" flowable:type="dmn">
      <extensionElements>
        <flowable:field name="decisionTableReferenceKey"><flowable:string><![CDATA[${tableKey}]]></flowable:string></flowable:field>
        <flowable:field name="decisionTaskThrowErrorOnNoHits"><flowable:string>true</flowable:string></flowable:field>
      </extensionElements>
    </serviceTask>
    <sequenceFlow id="f2" sourceRef="route" targetRef="which"/>
    <exclusiveGateway id="which" default="toOther"/>
    <sequenceFlow id="toLong" sourceRef="which" targetRef="long">
      <conditionExpression xsi:type="tFormalExpression">\${lane == 'long'}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="toClerk" sourceRef="which" targetRef="clerk">
      <conditionExpression xsi:type="tFormalExpression">\${lane == 'clerk'}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="toOther" sourceRef="which" targetRef="other"/>
    <userTask id="long"/>
    <userTask id="clerk"/>
    <userTask id="other"/>
    <sequenceFlow id="f3" sourceRef="long" targetRef="end"/>
    <sequenceFlow id="f4" sourceRef="clerk" targetRef="end"/>
    <sequenceFlow id="f5" sourceRef="other" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;
