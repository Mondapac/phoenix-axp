import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { PROCESS_KEY } from '../domain/bpmn-guard';
import { ListProcessDefinitions } from '../application/use-cases/list-process-definitions.use-case';
import { SaveProcessDraft } from '../application/use-cases/save-process-draft.use-case';
import { ViewProcessDefinition } from '../application/use-cases/view-process-definition.use-case';
import { answer, parseRequest } from './http';

// The JSON body limit of the API (64 KB) bounds a draft too, as it bounds a published model.
const draftBody = z.strictObject({
  bpmnXml: z.string().min(1),
  version: z.number().int().min(0),
});

const NOT_FOUND = { statusCode: 404, code: 'process.definition.not-found' };

/** A path process key; anything that is not one is the definition's 404. */
function keyParam(text: string): string {
  return PROCESS_KEY.test(text) ? text : answer({ ok: false, error: NOT_FOUND });
}

/** The modeler's process models of the caller's tenant: drafts and the latest published (D7). */
@ApiTags('process')
@Controller('process/definitions')
export class ProcessDefinitionsController {
  constructor(
    private readonly listDefinitions: ListProcessDefinitions,
    private readonly viewDefinition: ViewProcessDefinition,
    private readonly saveDraft: SaveProcessDraft,
  ) {}

  @Get()
  async list(@Call() context: CallContext) {
    const { items, truncated } = answer(await this.listDefinitions.execute(context, undefined));
    return {
      items: items.map((item) => ({
        processKey: item.processKey,
        draft:
          item.draft === null
            ? null
            : { version: item.draft.version, updatedAt: item.draft.updatedAt.toString() },
        published:
          item.published === null
            ? null
            : {
                revision: item.published.revision,
                publishedAt: item.published.publishedAt.toString(),
              },
      })),
      truncated,
    };
  }

  @Get(':processKey')
  async view(@Call() context: CallContext, @Param('processKey') processKey: string) {
    const found = answer(
      await this.viewDefinition.execute(context, { processKey: keyParam(processKey) }),
    );
    return {
      processKey: found.processKey,
      draft:
        found.draft === null
          ? null
          : {
              version: found.draft.version,
              updatedAt: found.draft.updatedAt.toString(),
              bpmnXml: found.draft.bpmnXml,
            },
      published:
        found.published === null
          ? null
          : {
              id: found.published.id,
              revision: found.published.revision,
              publishedAt: found.published.publishedAt.toString(),
              bpmnXml: found.published.bpmnXml,
            },
    };
  }

  /** Saves the draft of a key; `version` is the one read, 0 for a new key. */
  @Put(':processKey/draft')
  async save(
    @Call() context: CallContext,
    @Param('processKey') processKey: string,
    @Body() body: unknown,
  ) {
    const key = keyParam(processKey);
    return answer(
      await this.saveDraft.execute(context, { processKey: key, ...parseRequest(draftBody, body) }),
    );
  }
}
