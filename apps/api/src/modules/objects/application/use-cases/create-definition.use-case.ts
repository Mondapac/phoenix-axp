import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type SiteAncestryReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_DESIGN } from '../../contracts/permissions';
import { DEFINITION_CREATED } from '../../domain/audit-actions';
import { parseKey, parseName } from '../../domain/values';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository } from '../definition.repository';
import { SITE_NOT_FOUND, type InvalidValue, type KeyTaken, type SiteNotFound } from '../failures';

export interface CreateDefinitionInput {
  /** The site that owns the definition; its records live there or below. */
  readonly siteId: Id<'Site'>;
  readonly key: string;
  readonly name: string;
}

export type CreateDefinitionFailure = InvalidValue | SiteNotFound | KeyTaken;

/** Creates an Object definition as a draft, without a revision yet (ADR-0017 decision 2). */
export class CreateDefinition extends UseCase<
  CreateDefinitionInput,
  { id: Id<'ObjectDefinition'> },
  CreateDefinitionFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.create-definition',
    rule: { kind: 'permissions', allOf: [OBJECTS_DEFINITIONS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly reach: DefinitionReach,
    private readonly sites: SiteAncestryReader,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CreateDefinitionInput,
  ): Promise<Result<{ id: Id<'ObjectDefinition'> }, CreateDefinitionFailure>> {
    const key = parseKey(input.key);
    if (!key.ok) return key;
    const name = parseName(input.name);
    if (!name.ok) return name;
    // Port calls read in units of their own, so they come before this one.
    if (!(await this.sites.siteExists(context, input.siteId))) return err(SITE_NOT_FOUND);
    if (!(await this.reach.covers(context, OBJECTS_DEFINITIONS_DESIGN.key, input.siteId))) {
      return err(SITE_NOT_FOUND);
    }
    const id = this.ids.next<'ObjectDefinition'>();
    const { tenant } = context;
    return this.unitOfWork.run<{ id: Id<'ObjectDefinition'> }, CreateDefinitionFailure>(
      tenant,
      async () => {
        const created = await this.definitions.insert(
          tenant,
          { id, siteId: input.siteId, key: key.value, name: name.value },
          this.clock.now(),
        );
        if (created === 'key-taken') {
          return err({ code: 'objects.definition.key-taken' } as const);
        }
        await this.audit.record(
          context,
          DEFINITION_CREATED.entry(id, { after: { siteId: input.siteId } }),
        );
        return ok({ id });
      },
    );
  }
}
