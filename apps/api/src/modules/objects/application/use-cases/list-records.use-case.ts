import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_READ } from '../../contracts/permissions';
import type { DefinitionRepository } from '../definition.repository';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound } from '../failures';
import type { RecordAccess } from '../record-access';
import { recordViews } from '../record-views';
import type { RecordRepository, SiteFilter } from '../record.repository';
import { keysOf, type RecordView } from '../records';
import { servedDefinition } from '../served-definition';

export interface ListRecordsInput {
  readonly definitionKey: string;
  /** Only the records of this site. */
  readonly siteId: Id<'Site'> | null;
  /** The `next` of the previous page. */
  readonly before: Id<'ObjectRecord'> | null;
  readonly limit: number;
}

export interface RecordList {
  readonly items: readonly RecordView[];
  readonly next: Id<'ObjectRecord'> | null;
}

/**
 * A page of an Object's records, newest first, in the sites the caller's read grants reach
 * (ADR-0017 decision 5: filtered in the query), each shown through FieldPolicy. A caller whose
 * read grants reach no site of the definition gets "not found".
 */
export class ListRecords extends UseCase<ListRecordsInput, RecordList, DefinitionNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.list-records',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_READ.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly records: RecordRepository,
    private readonly access: RecordAccess,
    private readonly subjectKeys: SubjectKeyService,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ListRecordsInput,
  ): Promise<Result<RecordList, DefinitionNotFound>> {
    const { tenant } = context;
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition, current } = served;
    const reached = await this.access.sitesFor(context, definition, OBJECTS_RECORD_READ.key);
    if (reached !== 'all' && reached.length === 0) return err(DEFINITION_NOT_FOUND);
    let sites: SiteFilter = reached;
    if (input.siteId !== null) {
      sites = reached === 'all' || reached.includes(input.siteId) ? [input.siteId] : [];
    }
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const page = await this.records.list(tenant, definition.id, {
          sites,
          before: input.before,
          limit: input.limit + 1,
        });
        const shown = page.slice(0, input.limit);
        const revisions = await this.definitions.revisions(
          tenant,
          shown.map((record) => record.revisionId),
        );
        const keys = await keysOf(this.subjectKeys, context, shown);
        return ok({ shown, more: page.length > input.limit, revisions, keys });
      },
      { readOnly: true },
    );
    if (!read.ok) throw new Error('objects: the records could not be read');
    const { shown, more, revisions, keys } = read.value;
    const items = await recordViews(
      this.access,
      this.subjectKeys,
      context,
      definition,
      current,
      shown,
      revisions,
      keys,
    );
    return ok({ items, next: more ? shown[shown.length - 1]!.id : null });
  }
}
