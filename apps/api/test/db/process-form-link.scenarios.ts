import { ok, Temporal } from '@phoenix/shared-kernel';
import type { CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { FormReferences, PublishedFormReference } from '../../src/modules/forms';
import { FORMS_EVENTS, FORM_SUBMISSION_RECEIVED } from '../../src/modules/forms/domain/events';
import { CommandRelay } from '../../src/modules/process/application/bridge/command-relay';
import { EngineSync } from '../../src/modules/process/application/bridge/engine-sync';
import { EngineCommands } from '../../src/modules/process/application/engine-commands';
import { PublishProcessRevision } from '../../src/modules/process/application/use-cases/publish-process-revision.use-case';
import { StartProcessFromSubmission } from '../../src/modules/process/application/use-cases/start-process-from-submission.use-case';
import { PROCESS_PERMISSIONS } from '../../src/modules/process/contracts/permissions';
import { NodeBridgeHashing } from '../../src/modules/process/infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from '../../src/modules/process/infrastructure/prisma-process.repository';
import { startFromSubmissionSubscriber } from '../../src/modules/process/presentation/subscribers/start-from-submission.subscriber';
import type { SiteAncestryReader } from '../../src/platform/authz';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { SubscriptionRegistry } from '../../src/platform/events/event-subscriptions';
import { InProcessEventBus } from '../../src/platform/persistence/outbox/in-process-event-bus';
import { PrismaEventDispatcher } from '../../src/platform/persistence/outbox/prisma-event-dispatcher';
import { PrismaOutboxRelay } from '../../src/platform/persistence/outbox/prisma-outbox-relay';
import { TenantContextFactory } from '../../src/platform/tenant-context/tenant-context.factory';
import { FakeProcessEngine } from '../support/fake-process-engine';
import { RecordingAuditWriter, testTenantRegistry } from '../support/process-test-support';
import { TEST_TENANTS } from '../support/test-config';
import { moduleWriter } from './outbox-support';
import {
  createPersistence,
  modelMap,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.6: the form-to-process link against PostgreSQL, for both tenant fixtures. A
// revision pins the form revisions its model names (the forms facade is a stand-in here: a
// tenant's published forms by key); a stored submission's event, written by the forms outbox
// writer, travels the real relay, bus and dispatcher to the process subscriber, which starts
// the process once; the sync gives each task the form revision its revision pinned.
//
// process.db-spec.ts runs these after the bridge and inbox scenarios, in the same file: they
// drive the one sync state row of each tenant. The relay and the dispatcher pass over every
// tenant's pending events, so a parallel suite's forms events may be handled here too: their
// forms start no process, and every assertion below names this run's own ids.

export function formLinkScenarios(): void {
  describe.each(TEST_TENANTS)(
    'the form to process link in tenant %s (database integration)',
    (code) => {
      const tenant: TenantContext = tenantOf(code);
      const other: TenantContext = tenantOf(otherTenantOf(code));
      const index = TEST_TENANTS.indexOf(code);
      // After the bridge and inbox scenarios' clocks, so the shared watermarks hide nothing.
      const clock = new FixedClock(
        Temporal.Instant.from('2026-11-20T09:00:00Z').add({ minutes: index }),
      );
      const ids = new SequenceIdGenerator(clock);
      const audit = new RecordingAuditWriter();
      const engine = new FakeProcessEngine(clock);
      const tenants = testTenantRegistry();
      const system = testCallContext(tenant, 'system');
      const publisher = testCallContext(
        tenant,
        testAuthenticatedActor(tenant, {
          population: 'tenant-staff',
          accountId: ids.next<'Account'>(),
          sessionId: ids.next<'Session'>(),
        }),
      );
      const site = ids.next<'Site'>();
      const sites: SiteAncestryReader = {
        siteExists: (_context, siteId) => Promise.resolve(siteId === site),
        isWithinSubtree: () => Promise.resolve(false),
        sitesWithin: (_context, rootId) => Promise.resolve([rootId]),
      };

      // The tenant's published forms, as the forms facade answers the publisher.
      const suffix = `${code.replace('-', '_')}_${ids.next<'Probe'>().slice(-8)}`;
      const forms = {
        request: published(`request_${suffix}`),
        review: published(`review_${suffix}`),
        other: published(`other_${suffix}`),
      };
      function published(key: string): PublishedFormReference {
        return { key, formId: ids.next<'Form'>(), revisionId: ids.next<'FormRevision'>() };
      }
      const facadeCalls: {
        context: CallContext;
        keys: readonly string[];
        startKey: string | undefined;
      }[] = [];
      const references: FormReferences = {
        published: (context, keys, startKey) => {
          facadeCalls.push({ context, keys, startKey });
          return Promise.resolve(
            ok(Object.values(forms).filter((form) => keys.includes(form.key))),
          );
        },
      };

      const model = (
        key: string,
        startForm: string,
        taskForm = forms.review.key,
      ) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" isExecutable="true">
    <startEvent id="start" flowable:formKey="${startForm}"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <userTask id="approve" name="Review" flowable:formKey="${taskForm}"/>
    <sequenceFlow id="f2" sourceRef="approve" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

      let persistence: Persistence;
      let rows: Client;
      let flow: ReturnType<typeof build>;

      function build(p: Persistence) {
        const declared = new Map<string, PermissionDeclaration>(
          PROCESS_PERMISSIONS.declarations.map((d) => [d.key, d]),
        );
        const gate = createUseCaseGate(
          tenants,
          { get: (key) => declared.get(key) },
          { check: () => Promise.resolve({ allowed: true }) },
        );
        const uow = p.unitOfWork;
        const repository = new PrismaProcessRepository(p.service);
        const hashing = new NodeBridgeHashing();
        const commands = new EngineCommands(repository, ids, clock);
        const start = new StartProcessFromSubmission(
          gate,
          uow,
          repository,
          commands,
          sites,
          clock,
          ids,
        );
        const registry = new SubscriptionRegistry();
        registry.register('process', [startFromSubmissionSubscriber(start)]);
        registry.seal();
        const contexts = new TenantContextFactory(tenants);
        return {
          repository,
          relay: new CommandRelay(uow, repository, commands, engine, ids, clock, audit),
          sync: new EngineSync(uow, repository, commands, engine, hashing, ids, clock, tenants),
          publish: new PublishProcessRevision(
            gate,
            uow,
            repository,
            commands,
            hashing,
            audit,
            references,
            clock,
            ids,
          ),
          outbox: moduleWriter(p, 'forms', FORMS_EVENTS),
          eventRelay: new PrismaOutboxRelay(
            p.root,
            modelMap,
            tenants,
            contexts,
            new InProcessEventBus(registry, clock),
            clock,
          ),
          dispatcher: new PrismaEventDispatcher(p.root, tenants, contexts, registry, clock),
        };
      }

      beforeAll(async () => {
        persistence = createPersistence();
        rows = new Client({ connectionString: testDatabaseUrl() });
        await rows.connect();
        flow = build(persistence);
      });

      afterAll(async () => {
        await rows.end();
        await persistence.close();
      });

      async function rowsOf<R extends object>(of: TenantContext, sql: string, params: unknown[]) {
        await rows.query('BEGIN');
        try {
          await rows.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
            of.tenantId,
          ]);
          return (await rows.query<R>(sql, params)).rows;
        } finally {
          await rows.query('ROLLBACK');
        }
      }

      /** Stores a submission's event as the forms intake does, in a unit of its own. */
      async function submitted(
        form: PublishedFormReference,
        at: Id<'Site'> = site,
        submissionId: Id<'FormSubmission'> = ids.next<'FormSubmission'>(),
        version = 1,
      ): Promise<Id<'FormSubmission'>> {
        const context = testCallContext(tenant, 'system', `form-link-${ids.next()}`);
        const written = await persistence.unitOfWork.run(tenant, async () => {
          await flow.outbox.append(context, [
            FORM_SUBMISSION_RECEIVED.record({
              aggregateId: submissionId,
              aggregateVersion: version,
              occurredAt: clock.now(),
              payload: {
                formId: form.formId,
                revisionId: form.revisionId,
                siteId: at,
                channel: 'anonymous',
              },
            }),
          ]);
          return ok(undefined);
        });
        if (!written.ok) throw new Error('setup: outbox');
        return submissionId;
      }

      /** Relays and dispatches until nothing is left (other suites' events included). */
      async function deliver(): Promise<void> {
        for (let pass = 0; pass < 20; pass += 1) {
          const relayed = await flow.eventRelay.runOnce();
          const dispatched = await flow.dispatcher.runOnce();
          if (relayed.published === 0 && dispatched.claimed === 0) return;
        }
      }

      /** How the process subscriber's deliveries of a submission's events ended. */
      const deliveriesOf = (submissionId: string) =>
        rowsOf<{ status: string }>(
          tenant,
          `SELECT d.status FROM platform.event_delivery d
           JOIN forms.outbox o ON o.tenant_id = d.tenant_id AND o.event_id = d.event_id
          WHERE d.subscriber = 'process.start-from-submission' AND o.aggregate_id = $1
          ORDER BY o.aggregate_version`,
          [submissionId],
        );

      const instancesOf = (submissionId: string) =>
        rowsOf<{ id: string; revision_id: string; site_id: string | null; status: string }>(
          tenant,
          'SELECT id, revision_id, site_id, status FROM process.process_instance WHERE submission_id = $1',
          [submissionId],
        );

      let revisionId: Id<'ProcessRevision'>;
      const key = `intake_${suffix}`;

      it('pins the form revisions the model names, read as the publisher', async () => {
        const done = await flow.publish.execute(publisher, {
          processKey: key,
          bpmnXml: model(key, forms.request.key),
        });
        if (!done.ok) throw new Error(done.error.code);
        revisionId = done.value.id;
        expect(facadeCalls.at(-1)).toEqual({
          context: publisher,
          keys: [forms.request.key, forms.review.key],
          // The start form is answered only to a publisher of it (security review M2).
          startKey: forms.request.key,
        });
        const bindings = await rowsOf<object>(
          tenant,
          `SELECT element_id, kind, form_id, form_revision_id FROM process.process_form_binding
          WHERE revision_id = $1 ORDER BY element_id`,
          [revisionId],
        );
        expect(bindings).toEqual([
          {
            element_id: 'approve',
            kind: 'task',
            form_id: forms.review.formId,
            form_revision_id: forms.review.revisionId,
          },
          {
            element_id: 'start',
            kind: 'start',
            form_id: forms.request.formId,
            form_revision_id: forms.request.revisionId,
          },
        ]);
        expect(await flow.relay.runOnce(system)).toMatchObject({ delivered: 1 });
      });

      it('refuses a model naming a form that is not published or not visible (422)', async () => {
        const refusedKey = `missing_${suffix}`;
        const refused = await flow.publish.execute(publisher, {
          processKey: refusedKey,
          bpmnXml: model(refusedKey, forms.request.key, 'nobody-published-this'),
        });
        expect(refused).toEqual({
          ok: false,
          error: { code: 'process.form.not-found', field: 'approve' },
        });
        expect(
          await rowsOf(tenant, 'SELECT 1 FROM process.process_revision WHERE process_key = $1', [
            refusedKey,
          ]),
        ).toEqual([]);
      });

      it('lets a form start one process key only; nothing of the refused revision stays (409)', async () => {
        const rivalKey = `rival_${suffix}`;
        const refused = await flow.publish.execute(publisher, {
          processKey: rivalKey,
          bpmnXml: model(rivalKey, forms.request.key),
        });
        expect(refused).toEqual({
          ok: false,
          error: { code: 'process.form.starts-another-process', field: 'start' },
        });
        expect(
          await rowsOf(tenant, 'SELECT 1 FROM process.process_revision WHERE process_key = $1', [
            rivalKey,
          ]),
        ).toEqual([]);
        // A later revision of the key may not drop or change its start form: submissions of the
        // claimed one would start nothing.
        expect(
          await flow.publish.execute(publisher, {
            processKey: key,
            bpmnXml: model(key, forms.other.key),
          }),
        ).toEqual({
          ok: false,
          error: { code: 'process.form.start-form-changed', field: 'start' },
        });
        expect(
          await rowsOf(tenant, 'SELECT 1 FROM process.process_start_form WHERE form_id = $1', [
            forms.other.formId,
          ]),
        ).toEqual([]);
        expect(
          await rowsOf(tenant, 'SELECT 1 FROM process.process_revision WHERE process_key = $1', [
            key,
          ]),
        ).toHaveLength(1);
        // A later revision of the same key keeps the claim.
        const next = await flow.publish.execute(publisher, {
          processKey: key,
          bpmnXml: model(key, forms.request.key),
        });
        expect(next).toMatchObject({ ok: true, value: { revision: 2 } });
        if (next.ok) revisionId = next.value.id;
        expect(await flow.relay.runOnce(system)).toMatchObject({ delivered: 1 });
      });

      it('starts the newest revision once per submission, at its site, with ids only', async () => {
        const submissionId = await submitted(forms.request);
        await deliver();
        const [instance, ...more] = await instancesOf(submissionId);
        expect(more).toEqual([]);
        expect(instance).toMatchObject({
          revision_id: revisionId,
          site_id: site,
          status: 'starting',
        });
        const [command] = await rowsOf<{ payload: unknown }>(
          tenant,
          `SELECT payload FROM process.engine_command WHERE kind = 'start-instance' AND subject_id = $1`,
          [instance!.id],
        );
        expect(command!.payload).toEqual({
          revisionId,
          variables: {
            submissionId,
            formId: forms.request.formId,
            formRevisionId: forms.request.revisionId,
          },
        });

        // The engine starts it; the sync gives its task the form revision the revision pinned.
        expect(await flow.relay.runOnce(system)).toMatchObject({ delivered: 1 });
        await flow.sync.runOnce(system);
        const tasks = await rowsOf<{ task_key: string; form_revision_id: string | null }>(
          tenant,
          'SELECT task_key, form_revision_id FROM process.process_task WHERE instance_id = $1',
          [instance!.id],
        );
        expect(tasks).toEqual([{ task_key: 'approve', form_revision_id: forms.review.revisionId }]);

        // The same submission reported again (another event id) starts nothing more.
        await submitted(forms.request, site, submissionId, 2);
        await deliver();
        expect(await deliveriesOf(submissionId)).toEqual([
          { status: 'delivered' },
          { status: 'delivered' },
        ]);
        expect(await instancesOf(submissionId)).toHaveLength(1);
      });

      it('starts a submission of a form revision published after the process, with its own revision', async () => {
        // The process starts on any revision of its start form; the submission's revision is
        // the one it passes on (the task forms stay those the process revision pinned).
        const republished = { ...forms.request, revisionId: ids.next<'FormRevision'>() };
        const submissionId = await submitted(republished);
        await deliver();
        const [instance] = await instancesOf(submissionId);
        const [command] = await rowsOf<{ payload: { variables: object } }>(
          tenant,
          `SELECT payload FROM process.engine_command WHERE kind = 'start-instance' AND subject_id = $1`,
          [instance!.id],
        );
        expect(command!.payload.variables).toEqual({
          submissionId,
          formId: forms.request.formId,
          formRevisionId: republished.revisionId,
        });
        expect(await flow.relay.runOnce(system)).toMatchObject({ delivered: 1 });
      });

      it('starts nothing for a form no process starts, or a site the tenant does not have', async () => {
        const plain = await submitted(forms.other);
        const astray = await submitted(forms.request, ids.next<'Site'>());
        await deliver();
        // Handled, not failed: neither delivery comes due again.
        expect(await deliveriesOf(plain)).toEqual([{ status: 'delivered' }]);
        expect(await deliveriesOf(astray)).toEqual([{ status: 'delivered' }]);
        expect(await instancesOf(plain)).toEqual([]);
        expect(await instancesOf(astray)).toEqual([]);
      });

      it('keeps the link in its tenant: the other tenant sees none of it', async () => {
        expect(
          await rowsOf(other, 'SELECT 1 FROM process.process_form_binding WHERE revision_id = $1', [
            revisionId,
          ]),
        ).toEqual([]);
        expect(
          await rowsOf(other, 'SELECT 1 FROM process.process_start_form WHERE form_id = $1', [
            forms.request.formId,
          ]),
        ).toEqual([]);
      });
    },
  );
}
