import { Body, Controller, HttpCode, Inject, Logger, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import type { AppConfig } from '../../../platform/config/app-config';
import { APP_CONFIG } from '../../../platform/config/config.module';
import {
  DEFAULT_GRAPHQL_LIMITS,
  graphqlRequestBody,
  introspectionAllowed,
  runGraphql,
  type GraphqlAnswer,
  type GraphqlLimits,
} from '../../../platform/graphql';
import { CreateRecord } from '../application/use-cases/create-record.use-case';
import { DeleteRecord } from '../application/use-cases/delete-record.use-case';
import { DescribeObject } from '../application/use-cases/describe-object.use-case';
import { ListRecords } from '../application/use-cases/list-records.use-case';
import { UpdateRecord } from '../application/use-cases/update-record.use-case';
import { ViewRecord } from '../application/use-cases/view-record.use-case';
import { recordOperationsOf, recordSchema } from './graphql/record-schema';
import { answer, idField, parseRequest } from './http';

const describeQuery = z.strictObject({ site: idField<'Site'>().optional() });

/** A definition key in the path; anything else answers as an unknown definition. */
const definitionKey = (text: string): string =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 64
    ? text
    : answer({ ok: false, error: { code: 'objects.definition.not-found' } });

/**
 * The generated GraphQL API of every Object (ADR-0017 decision 8, D6). The schema is built for
 * the caller from DescribeObject at `?site=` (the definition's own site when absent), so a
 * caller who may not read the Object there gets the same 401 or 404 as REST; every resolver
 * then calls the record use case REST calls. GraphQL answers come back with status 200.
 */
@ApiTags('objects')
@Controller('objects/o')
export class ObjectGraphqlController {
  private readonly logger = new Logger(ObjectGraphqlController.name);
  private readonly limits: GraphqlLimits;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly describeObject: DescribeObject,
    private readonly listRecords: ListRecords,
    private readonly viewRecord: ViewRecord,
    private readonly createRecord: CreateRecord,
    private readonly updateRecord: UpdateRecord,
    private readonly deleteRecord: DeleteRecord,
  ) {
    this.limits = { ...DEFAULT_GRAPHQL_LIMITS, introspection: introspectionAllowed(config) };
  }

  @Post(':key/graphql')
  @HttpCode(200)
  async graphql(
    @Call() context: CallContext,
    @Param('key') key: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<GraphqlAnswer> {
    const objectKey = definitionKey(key);
    const { site } = parseRequest(describeQuery, query);
    const request = parseRequest(graphqlRequestBody, body);
    // The document is parsed and sized first: the Object is described only for one that fits.
    const schemaOf = async () => {
      const object = answer(
        await this.describeObject.execute(context, {
          definitionKey: objectKey,
          siteId: site ?? null,
        }),
      );
      return recordSchema(
        object,
        recordOperationsOf(
          {
            view: this.viewRecord,
            list: this.listRecords,
            create: this.createRecord,
            update: this.updateRecord,
            remove: this.deleteRecord,
          },
          objectKey,
        ),
      );
    };
    return runGraphql(schemaOf, request, context, this.limits, (error) =>
      this.logger.error({
        msg: 'objects.graphql.resolver-failed',
        definitionKey: objectKey,
        operationName: request.operationName ?? null,
        err: error,
      }),
    );
  }
}
