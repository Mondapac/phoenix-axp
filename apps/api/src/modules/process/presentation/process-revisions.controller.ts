import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { PublishProcessRevision } from '../application/use-cases/publish-process-revision.use-case';
import { answer, parseRequest } from './http';

// The JSON body limit of the API (64 KB) bounds the model too; the domain's own ceiling is 1 MB.
const publishBody = z.strictObject({
  processKey: z.string().max(64),
  bpmnXml: z.string().min(1),
});

/** Publishing process models of the caller's tenant (studio API; owner decision D7). */
@ApiTags('process')
@Controller('process/revisions')
export class ProcessRevisionsController {
  constructor(private readonly publishProcessRevision: PublishProcessRevision) {}

  @Post()
  async publish(@Call() context: CallContext, @Body() body: unknown) {
    return answer(
      await this.publishProcessRevision.execute(context, parseRequest(publishBody, body)),
    );
  }
}
