import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { ReplaceWorkingCalendar } from '../application/use-cases/replace-working-calendar.use-case';
import { ViewWorkingCalendar } from '../application/use-cases/view-working-calendar.use-case';
import { MAX_HOLIDAYS } from '../domain/deadline';
import { answer, parseRequest } from './http';

const replaceBody = z.strictObject({
  weekendDays: z.array(z.number().int()).max(7),
  holidays: z.array(z.string().max(10)).max(MAX_HOLIDAYS),
  version: z.number().int().min(0),
});

/** The tenant's working calendar for working-day deadlines (owner decision D4). */
@ApiTags('process')
@Controller('process/working-calendar')
export class WorkingCalendarController {
  constructor(
    private readonly viewWorkingCalendar: ViewWorkingCalendar,
    private readonly replaceWorkingCalendar: ReplaceWorkingCalendar,
  ) {}

  @Get()
  async view(@Call() context: CallContext) {
    return answer(await this.viewWorkingCalendar.execute(context, undefined));
  }

  @Put()
  async replace(@Call() context: CallContext, @Body() body: unknown) {
    return answer(
      await this.replaceWorkingCalendar.execute(context, parseRequest(replaceBody, body)),
    );
  }
}
