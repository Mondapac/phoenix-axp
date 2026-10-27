import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { CreateLocalStaffAccount } from '../application/use-cases/create-local-staff-account.use-case';
import { DisableStaffAccount } from '../application/use-cases/disable-staff-account.use-case';
import { ListStaffAccounts } from '../application/use-cases/list-staff-accounts.use-case';
import { answer, idParam, parseRequest } from './http';

const NOT_FOUND = 'identity.account.not-found';

const createBody = z.strictObject({ username: z.string().max(1024) });
const disableBody = z.strictObject({ version: z.number().int().min(1) });

/** The staff accounts of the caller's tenant (studio API; ADR-0019). */
@ApiTags('identity')
@Controller('identity/staff-accounts')
export class StaffAccountsController {
  constructor(
    private readonly listStaffAccounts: ListStaffAccounts,
    private readonly createLocalStaffAccount: CreateLocalStaffAccount,
    private readonly disableStaffAccount: DisableStaffAccount,
  ) {}

  @Get()
  async list(@Call() context: CallContext) {
    const accounts = answer(await this.listStaffAccounts.execute(context, undefined));
    return {
      items: accounts.map((account) => ({
        id: account.id,
        source: account.source,
        username: account.username,
        status: account.status,
        signedInOnce: account.subject !== null,
        version: account.version,
        createdAt: account.createdAt.toString(),
      })),
    };
  }

  /** A local account, before its person's first sign-in. */
  @Post()
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(
      await this.createLocalStaffAccount.execute(context, parseRequest(createBody, body)),
    );
  }

  @Post(':accountId/disable')
  async disable(
    @Call() context: CallContext,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ) {
    return answer(
      await this.disableStaffAccount.execute(context, {
        accountId: idParam<'Account'>(accountId, NOT_FOUND),
        ...parseRequest(disableBody, body),
      }),
    );
  }
}
