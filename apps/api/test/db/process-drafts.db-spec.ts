import { Temporal } from '@phoenix/shared-kernel';
import type { CallContext, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { EngineCommands } from '../../src/modules/process/application/engine-commands';
import { ListProcessDefinitions } from '../../src/modules/process/application/use-cases/list-process-definitions.use-case';
import { PublishProcessRevision } from '../../src/modules/process/application/use-cases/publish-process-revision.use-case';
import { SaveProcessDraft } from '../../src/modules/process/application/use-cases/save-process-draft.use-case';
import { ViewProcessDefinition } from '../../src/modules/process/application/use-cases/view-process-definition.use-case';
import { PROCESS_PERMISSIONS } from '../../src/modules/process/contracts/permissions';
import { NodeBridgeHashing } from '../../src/modules/process/infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from '../../src/modules/process/infrastructure/prisma-process.repository';
import {
  ANY_FORMS,
  RecordingAuditWriter,
  testTenantRegistry,
} from '../support/process-test-support';
import { TEST_TENANTS } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';

// Slice 2.10: the modeler's drafts (owner decision D7) against PostgreSQL, through the real
// repository, UnitOfWork, tenant guard and row-level security, in both test tenants. A draft is
// overwritten under its version, may be unfinished, is never deployed, and is the tenant's own.

const model = (key: string, task = '<userTask id="review" name="بررسی"/>') =>
  `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
    ${task}
    <sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

describe.each(TEST_TENANTS)('process drafts in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-30T08:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  const staff = (of: TenantContext): CallContext =>
    testCallContext(
      of,
      testAuthenticatedActor(of, {
        population: 'tenant-staff',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
  let persistence: Persistence;
  let use: ReturnType<typeof build>;
  let keys = 0;
  const nextKey = () => `draft_${code.replace(/-/g, '_')}_${++keys}`;

  function build(p: Persistence, allowed = true) {
    const declared = new Map<string, PermissionDeclaration>(
      PROCESS_PERMISSIONS.declarations.map((d) => [d.key, d]),
    );
    const gate = createUseCaseGate(
      testTenantRegistry(),
      { get: (key) => declared.get(key) },
      {
        check: () =>
          Promise.resolve(
            allowed ? { allowed: true } : { allowed: false, denial: { code: 'access.denied' } },
          ),
      },
    );
    const repository = new PrismaProcessRepository(p.service);
    const commands = new EngineCommands(repository, ids, clock);
    return {
      save: new SaveProcessDraft(gate, p.unitOfWork, repository, audit, clock, ids),
      list: new ListProcessDefinitions(gate, p.unitOfWork, repository),
      view: new ViewProcessDefinition(gate, p.unitOfWork, repository),
      publish: new PublishProcessRevision(
        gate,
        p.unitOfWork,
        repository,
        commands,
        new NodeBridgeHashing(),
        audit,
        ANY_FORMS,
        clock,
        ids,
      ),
    };
  }

  beforeAll(() => {
    persistence = createPersistence();
    use = build(persistence);
  });
  afterAll(() => persistence.close());

  it('saves a first draft, overwrites it under its version and audits each save', async () => {
    const key = nextKey();
    const first = await use.save.execute(staff(tenant), {
      processKey: key,
      bpmnXml: model(key),
      version: 0,
    });
    expect(first).toEqual({ ok: true, value: { version: 1, problem: null } });
    clock.advance(Temporal.Duration.from({ minutes: 1 }));
    const second = await use.save.execute(staff(tenant), {
      processKey: key,
      bpmnXml: model(key, '<userTask id="review" name="بررسی دوباره"/>'),
      version: 1,
    });
    expect(second).toEqual({ ok: true, value: { version: 2, problem: null } });

    const viewed = await use.view.execute(staff(tenant), { processKey: key });
    expect(viewed.ok && viewed.value.draft).toMatchObject({
      processKey: key,
      version: 2,
      updatedAt: clock.now(),
    });
    expect(viewed.ok && viewed.value.draft?.bpmnXml).toContain('بررسی دوباره');
    expect(viewed.ok && viewed.value.published).toBeNull();
    expect(
      audit.entries.filter((entry) => entry.action === 'process.draft.saved').slice(-2),
    ).toEqual([
      expect.objectContaining({ after: { version: 1 } }),
      expect.objectContaining({ after: { version: 2 } }),
    ]);
  });

  it('refuses a stale version, and a second first save of one key', async () => {
    const key = nextKey();
    const save = (version: number) =>
      use.save.execute(staff(tenant), { processKey: key, bpmnXml: model(key), version });
    await save(0);
    await expect(save(0)).rejects.toBeInstanceOf(StaleAggregateError);
    await save(1);
    await expect(save(1)).rejects.toBeInstanceOf(StaleAggregateError);
  });

  it('keeps an unfinished draft with the reason it cannot be published yet', async () => {
    const key = nextKey();
    const saved = await use.save.execute(staff(tenant), {
      processKey: key,
      bpmnXml: model(key, '<scriptTask id="review"/>'),
      version: 0,
    });
    expect(saved).toEqual({
      ok: true,
      value: {
        version: 1,
        problem: { code: 'process.bpmn.forbidden-construct', field: 'scriptTask' },
      },
    });
  });

  it('refuses a model of another key or that is not XML, and stores nothing', async () => {
    const key = nextKey();
    expect(
      await use.save.execute(staff(tenant), {
        processKey: key,
        bpmnXml: model('other'),
        version: 0,
      }),
    ).toEqual({ ok: false, error: { code: 'process.bpmn.process-key-mismatch' } });
    expect(
      await use.save.execute(staff(tenant), {
        processKey: key,
        bpmnXml: '<definitions',
        version: 0,
      }),
    ).toEqual({ ok: false, error: { code: 'process.bpmn.malformed' } });
    expect(await use.view.execute(staff(tenant), { processKey: key })).toEqual({
      ok: false,
      error: { code: 'process.definition.not-found' },
    });
  });

  it('refuses a model the guard stopped early when it is of another key or holds a DOCTYPE', async () => {
    const key = nextKey();
    const script = '<scriptTask id="review" scriptFormat="groovy"><script>x</script></scriptTask>';
    expect(
      await use.save.execute(staff(tenant), {
        processKey: key,
        bpmnXml: model('other', script),
        version: 0,
      }),
    ).toEqual({ ok: false, error: { code: 'process.bpmn.process-key-mismatch' } });
    // Another attribute's value is not the process id (security re-review of the fix).
    expect(
      await use.save.execute(staff(tenant), {
        processKey: key,
        bpmnXml: model('other', script).replace('<process ', `<process name=' id="${key}"' `),
        version: 0,
      }),
    ).toEqual({ ok: false, error: { code: 'process.bpmn.process-key-mismatch' } });
    expect(
      await use.save.execute(staff(tenant), {
        processKey: key,
        bpmnXml: model(key).replace('<definitions', '<!DOCTYPE x>\n<definitions'),
        version: 0,
      }),
    ).toEqual({ ok: false, error: { code: 'process.bpmn.malformed' } });
    // The same refused construct in a model of this key is an unfinished draft.
    const kept = await use.save.execute(staff(tenant), {
      processKey: key,
      bpmnXml: model(key, script),
      version: 0,
    });
    expect(kept).toEqual({
      ok: true,
      value: {
        version: 1,
        problem: { code: 'process.bpmn.forbidden-construct', field: 'scriptTask' },
      },
    });
  });

  it('refuses staff without process.definitions.design on every draft use case', async () => {
    const denied = build(persistence, false);
    const refusal = { ok: false, error: { code: 'access.denied' } };
    expect(
      await denied.save.execute(staff(tenant), {
        processKey: nextKey(),
        bpmnXml: model('x'),
        version: 0,
      }),
    ).toEqual(refusal);
    expect(await denied.list.execute(staff(tenant), undefined)).toEqual(refusal);
    expect(await denied.view.execute(staff(tenant), { processKey: 'x' })).toEqual(refusal);
  });

  it('lists drafts and published keys in key order, with the latest revision', async () => {
    const drafted = `a_${nextKey()}`;
    const publishedOnly = `b_${nextKey()}`;
    await use.save.execute(staff(tenant), {
      processKey: drafted,
      bpmnXml: model(drafted),
      version: 0,
    });
    for (let n = 0; n < 2; n += 1) {
      const result = await use.publish.execute(staff(tenant), {
        processKey: publishedOnly,
        bpmnXml: model(publishedOnly),
      });
      expect(result.ok).toBe(true);
    }
    const listed = await use.list.execute(staff(tenant), undefined);
    if (!listed.ok) throw new Error('list refused');
    const mine = listed.value.items.filter((item) =>
      [drafted, publishedOnly].includes(item.processKey),
    );
    expect(mine).toEqual([
      { processKey: drafted, draft: { version: 1, updatedAt: clock.now() }, published: null },
      {
        processKey: publishedOnly,
        draft: null,
        published: { revision: 2, publishedAt: clock.now() },
      },
    ]);
    expect(listed.value.truncated).toBe(false);
    const viewed = await use.view.execute(staff(tenant), { processKey: publishedOnly });
    expect(viewed.ok && viewed.value.published).toMatchObject({ revision: 2 });
  });

  it("never shows one tenant's drafts to another", async () => {
    const key = nextKey();
    await use.save.execute(staff(tenant), { processKey: key, bpmnXml: model(key), version: 0 });
    expect(await use.view.execute(staff(other), { processKey: key })).toEqual({
      ok: false,
      error: { code: 'process.definition.not-found' },
    });
    const listed = await use.list.execute(staff(other), undefined);
    expect(listed.ok && listed.value.items.some((item) => item.processKey === key)).toBe(false);
    // The other tenant may use the same key for its own draft.
    expect(
      await use.save.execute(staff(other), { processKey: key, bpmnXml: model(key), version: 0 }),
    ).toEqual({ ok: true, value: { version: 1, problem: null } });
  });
});
