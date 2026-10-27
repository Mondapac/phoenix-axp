import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import {
  ListProcessIncidents,
  MAX_INCIDENTS,
} from '../application/use-cases/list-process-incidents.use-case';
import { answer, parseRequest } from './http';

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_INCIDENTS).default(50),
});

/** The process bridge's incidents of the caller's tenant, for operators (PoC 3 R3, R10). */
@ApiTags('process')
@Controller('process/incidents')
export class ProcessIncidentsController {
  constructor(private readonly listProcessIncidents: ListProcessIncidents) {}

  @Get()
  async list(@Call() context: CallContext, @Query() query: unknown) {
    const incidents = answer(
      await this.listProcessIncidents.execute(context, parseRequest(listQuery, query)),
    );
    return {
      items: incidents.map((incident) => ({
        id: incident.id,
        kind: incident.kind,
        engineRef: incident.engineRef,
        instanceId: incident.instanceId,
        detectedAt: incident.detectedAt.toString(),
      })),
    };
  }
}
