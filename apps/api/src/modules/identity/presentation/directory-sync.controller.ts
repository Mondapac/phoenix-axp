import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { RunDirectorySyncNow } from '../application/use-cases/run-directory-sync-now.use-case';
import { UpdateDirectorySyncInterval } from '../application/use-cases/update-directory-sync-interval.use-case';
import { ViewDirectorySync } from '../application/use-cases/view-directory-sync.use-case';
import { answer, parseRequest } from './http';

const intervalBody = z.strictObject({
  version: z.number().int().min(1),
  intervalMinutes: z.number().int(),
});

/** The tenant's staff directory sync (studio API; ADR-0022 decision 6). */
@ApiTags('identity')
@Controller('identity/directory-sync')
export class DirectorySyncController {
  constructor(
    private readonly viewDirectorySync: ViewDirectorySync,
    private readonly updateInterval: UpdateDirectorySyncInterval,
    private readonly runNow: RunDirectorySyncNow,
  ) {}

  @Get()
  async view(@Call() context: CallContext) {
    const state = answer(await this.viewDirectorySync.execute(context, undefined));
    return {
      ...state,
      lastStartedAt: state.lastStartedAt?.toString() ?? null,
      lastFinishedAt: state.lastFinishedAt?.toString() ?? null,
    };
  }

  @Put()
  @HttpCode(204)
  async setInterval(@Call() context: CallContext, @Body() body: unknown): Promise<void> {
    answer(await this.updateInterval.execute(context, parseRequest(intervalBody, body)));
  }

  /** "Sync now": runs the sync at once and answers its summary. */
  @Post('run')
  @HttpCode(200)
  async run(@Call() context: CallContext) {
    return answer(await this.runNow.execute(context, undefined));
  }
}
