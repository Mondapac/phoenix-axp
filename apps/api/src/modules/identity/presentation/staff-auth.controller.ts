// SPIKE (PoC 2): staff sign-in over HTTP. The BFF sets x-tenant-id from the panel's host
// (ADR-0004); here the test's browser sends it. Cookies:
//   __Host-phoenix-flow    the flow secret; SameSite=Lax, because the IdP's redirect back to the
//                          callback is a cross-site top-level navigation (Strict would drop it)
//   __Host-phoenix-studio  the session token; SameSite=Strict, set by the callback response
import type { Response } from 'express';
import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { CallContext } from '@phoenix/shared-kernel';
import { httpFailure, STUDIO_SESSION_COOKIE } from '../../../platform/authz';
import { cookieOf } from '../../../platform/call-context/actor.guard';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { BeginStaffSignIn, CompleteStaffSignIn } from '../application/use-cases/sign-in.use-cases';

const FLOW_COOKIE = '__Host-phoenix-flow';

@Controller('spike/auth')
export class StaffAuthController {
  constructor(
    private readonly begin: BeginStaffSignIn,
    private readonly complete: CompleteStaffSignIn,
  ) {}

  @Get('sign-in')
  async signIn(@Call() call: CallContext, @Res() response: Response): Promise<void> {
    const result = await this.begin.execute(call, undefined);
    if (!result.ok) throw httpFailure(result.error, {});
    response.cookie(FLOW_COOKIE, result.value.flowSecret, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    response.redirect(302, result.value.authorizationUrl);
  }

  @Get('callback')
  async callback(
    @Call() call: CallContext,
    @Req() request: IncomingMessage,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.complete.execute(call, {
      code: typeof code === 'string' ? code : '',
      state: typeof state === 'string' ? state : '',
      flowSecret: cookieOf(request, FLOW_COOKIE) ?? '',
    });
    response.clearCookie(FLOW_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    if (!result.ok) {
      throw httpFailure(result.error, {
        'sign-in.flow-invalid': 400,
        'sign-in.rejected': 401,
        'sign-in.unavailable': 503,
        'sign-in.no-staff-account': 403,
        'sign-in.account-disabled': 403,
      });
    }
    response.cookie(STUDIO_SESSION_COOKIE, result.value.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      expires: new Date(result.value.expiresAt.epochMilliseconds),
    });
    return { signedIn: true, accountId: result.value.accountId };
  }

  @Post('who-am-i')
  @HttpCode(200)
  whoAmI(@Call() call: CallContext) {
    return {
      actor: call.actor.kind,
      accountId: call.actor.kind === 'authenticated' ? call.actor.accountId : null,
    };
  }
}
