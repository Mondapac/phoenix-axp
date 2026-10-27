import type { IncomingMessage } from 'node:http';
import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import type { Response } from 'express';
import { z } from 'zod';
import { STUDIO_SESSION_COOKIE } from '../../../platform/authz';
import { Call } from '../../../platform/call-context/call-context.decorator';
import type { AppConfig } from '../../../platform/config/app-config';
import { APP_CONFIG } from '../../../platform/config/config.module';
import { cookieValue, csrfTokenOf } from '../../../platform/http/session-cookies';
import { BeginStaffSignIn } from '../application/use-cases/begin-staff-sign-in.use-case';
import { CompleteStaffSignIn } from '../application/use-cases/complete-staff-sign-in.use-case';
import { SignOut } from '../application/use-cases/sign-out.use-case';
import { ViewOwnAccount } from '../application/use-cases/view-own-account.use-case';
import { answer, parseRequest } from './http';

/**
 * The flow secret of a pending sign-in. SameSite=Lax: Keycloak's redirect back to the callback
 * is a cross-site top-level navigation, which Strict would drop. Ten minutes.
 */
const FLOW_COOKIE = '__Host-phoenix-flow';
const FLOW_MAX_AGE_MS = 10 * 60 * 1000;

const callbackQuery = z.object({
  code: z.string().max(4096).default(''),
  state: z.string().max(256).default(''),
});

/**
 * Staff sign-in and sign-out for the studio panel (ADR-0004 decisions 1 and 2). The studio BFF
 * calls these routes on the browser's behalf: it sets `x-tenant-id` from its host, forwards the
 * cookies and relays `Set-Cookie`. Keycloak redirects the browser to the BFF's callback URL,
 * which forwards `code` and `state` to `callback`.
 */
@ApiTags('identity')
@Controller('identity/staff')
export class StaffSignInController {
  constructor(
    private readonly begin: BeginStaffSignIn,
    private readonly complete: CompleteStaffSignIn,
    private readonly signOut: SignOut,
    private readonly viewOwnAccount: ViewOwnAccount,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  readonly #logger = new Logger('StaffSignIn');

  /** Redirects to the tenant's Keycloak realm, with the flow secret in its cookie. */
  @Get('sign-in')
  async signIn(@Call() context: CallContext, @Res() response: Response): Promise<void> {
    const began = answer(await this.begin.execute(context, undefined));
    response.cookie(FLOW_COOKIE, began.flowSecret, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: FLOW_MAX_AGE_MS,
    });
    response.redirect(302, began.authorizationUrl);
  }

  /** Starts the session: the session cookie, and the session's CSRF token in the body. */
  @Get('sign-in/callback')
  async callback(
    @Call() context: CallContext,
    @Req() request: IncomingMessage,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { code, state } = parseRequest(callbackQuery, query);
    const result = await this.complete.execute(context, {
      code,
      state,
      flowSecret: cookieValue(request.headers.cookie, FLOW_COOKIE) ?? '',
    });
    response.clearCookie(FLOW_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    if (!result.ok) {
      // A refused sign-in leaves a trace for operations and for sign-in rate limiting: the
      // reason code and the account when known, never the username, the code or the state.
      this.#logger.warn({
        msg: 'identity.sign-in.refused',
        reason: result.error.code,
        accountId: 'accountId' in result.error ? result.error.accountId : null,
        tenantId: context.tenant.tenantId,
        correlationId: context.correlationId,
      });
    }
    const session = answer(result);
    response.cookie(STUDIO_SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      expires: new Date(session.expiresAt.epochMilliseconds),
    });
    return {
      accountId: session.accountId,
      expiresAt: session.expiresAt.toString(),
      csrfToken: csrfTokenOf(this.config.session.secret, session.sessionToken),
    };
  }

  /** Ends the caller's session and drops its cookie. */
  @Post('sign-out')
  @HttpCode(204)
  async end(
    @Call() context: CallContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    answer(await this.signOut.execute(context, undefined));
    response.clearCookie(STUDIO_SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  }

  /** Who the caller is, and the CSRF token of the session the request carried. */
  @Get('me')
  async me(@Call() context: CallContext, @Req() request: IncomingMessage) {
    const account = answer(await this.viewOwnAccount.execute(context, undefined));
    const token = cookieValue(request.headers.cookie, STUDIO_SESSION_COOKIE) ?? '';
    return { ...account, csrfToken: csrfTokenOf(this.config.session.secret, token) };
  }
}
