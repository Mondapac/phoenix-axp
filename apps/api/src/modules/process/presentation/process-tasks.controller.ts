import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import type { InboxTask } from '../application/use-cases/view-task.use-case';
import { AssignTask } from '../application/use-cases/assign-task.use-case';
import { ClaimTask } from '../application/use-cases/claim-task.use-case';
import { CompleteTask } from '../application/use-cases/complete-task.use-case';
import { ListMyTasks, MAX_INBOX_TASKS } from '../application/use-cases/list-my-tasks.use-case';
import { ListSiteTasks } from '../application/use-cases/list-site-tasks.use-case';
import { ReleaseTask } from '../application/use-cases/release-task.use-case';
import { ViewTask } from '../application/use-cases/view-task.use-case';
import { answer, idField, idParam, parseRequest } from './http';

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_INBOX_TASKS).default(50),
});
const completeBody = z.strictObject({
  outcome: z.string().max(32).nullable().default(null),
});
const assignBody = z.strictObject({ accountId: idField<'Account'>() });

const NOT_FOUND = 'process.task.not-found';

const taskJson = (task: InboxTask) => ({
  id: task.id,
  instanceId: task.instanceId,
  taskKey: task.taskKey,
  name: task.name,
  formKey: task.formKey,
  status: task.status,
  siteId: task.siteId,
  queueRoleId: task.queueRoleId,
  assigneeAccountId: task.assigneeAccountId,
  dueAt: task.dueAt?.toString() ?? null,
  overdue: task.overdue,
  escalatedAt: task.escalatedAt?.toString() ?? null,
  outcomes: task.outcomes,
  version: task.version,
});

/** The task inbox of the caller's tenant (studio API; ADR-0025, owner decision D3). */
@ApiTags('process')
@Controller('process/tasks')
export class ProcessTasksController {
  constructor(
    private readonly listMyTasks: ListMyTasks,
    private readonly listSiteTasks: ListSiteTasks,
    private readonly viewTask: ViewTask,
    private readonly claimTask: ClaimTask,
    private readonly releaseTask: ReleaseTask,
    private readonly assignTask: AssignTask,
    private readonly completeTask: CompleteTask,
  ) {}

  /** "My tasks": held by the caller, or waiting in its queues. */
  @Get()
  async mine(@Call() context: CallContext, @Query() query: unknown) {
    const tasks = answer(await this.listMyTasks.execute(context, parseRequest(listQuery, query)));
    return { items: tasks.map(taskJson) };
  }

  /** Every open task at the sites the caller supervises. */
  @Get('supervised')
  async supervised(@Call() context: CallContext, @Query() query: unknown) {
    const tasks = answer(await this.listSiteTasks.execute(context, parseRequest(listQuery, query)));
    return { items: tasks.map(taskJson) };
  }

  @Get(':taskId')
  async view(@Call() context: CallContext, @Param('taskId') taskId: string) {
    const taskIdValue = idParam<'ProcessTask'>(taskId, NOT_FOUND);
    return taskJson(answer(await this.viewTask.execute(context, { taskId: taskIdValue })));
  }

  @Post(':taskId/claim')
  @HttpCode(200)
  async claim(@Call() context: CallContext, @Param('taskId') taskId: string) {
    return answer(
      await this.claimTask.execute(context, { taskId: idParam<'ProcessTask'>(taskId, NOT_FOUND) }),
    );
  }

  @Post(':taskId/release')
  @HttpCode(200)
  async release(@Call() context: CallContext, @Param('taskId') taskId: string) {
    return answer(
      await this.releaseTask.execute(context, {
        taskId: idParam<'ProcessTask'>(taskId, NOT_FOUND),
      }),
    );
  }

  @Post(':taskId/assign')
  @HttpCode(200)
  async assign(
    @Call() context: CallContext,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const id = idParam<'ProcessTask'>(taskId, NOT_FOUND);
    const { accountId } = parseRequest(assignBody, body);
    return answer(await this.assignTask.execute(context, { taskId: id, accountId }));
  }

  /** Decides the task; the engine completes it shortly after (`status: completing`). */
  @Post(':taskId/complete')
  @HttpCode(202)
  async complete(
    @Call() context: CallContext,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const id = idParam<'ProcessTask'>(taskId, NOT_FOUND);
    const { outcome } = parseRequest(completeBody, body ?? {});
    return answer(await this.completeTask.execute(context, { taskId: id, outcome }));
  }
}
