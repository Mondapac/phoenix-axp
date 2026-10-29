import type { IncomingMessage } from 'node:http';
import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PORTAL_SESSION_COOKIE } from '../../../platform/authz';
import { Call } from '../../../platform/call-context/call-context.decorator';
import type { AppConfig } from '../../../platform/config/app-config';
import { APP_CONFIG } from '../../../platform/config/config.module';
import { cookieValue, csrfTokenOf } from '../../../platform/http/session-cookies';
import { IssuePortalChallenge } from '../application/use-cases/issue-portal-challenge.use-case';
import { RequestPortalCode } from '../application/use-cases/request-portal-code.use-case';
import { SignOut } from '../application/use-cases/sign-out.use-case';
import { VerifyPortalCode } from '../application/use-cases/verify-portal-code.use-case';
import { ViewOwnPortalAccount } from '../application/use-cases/view-own-portal-account.use-case';
import { ViewPortalSignInOptions } from '../application/use-cases/view-portal-sign-in-options.use-case';
import { PORTAL_METHODS } from '../domain/portal';
import { answer, idField, parseRequest } from './http';

const method = z.enum(PORTAL_METHODS);
// The address travels in the body only, never in a URL, so it stays out of access logs.
const codeBody = z.strictObject({
  method,
  address: z.string().max(320),
  captcha: z.string().max(2048),
});
const signInBody = z.strictObject({
  challengeId: idField<'PortalCode'>(),
  method,
  address: z.string().max(320),
  code: z.string().max(16),
});

/**
 * The client's address, for the rate limits only: the socket's, or the trusted proxy's
 * `X-Forwarded-For` when `TRUSTED_PROXIES` names the portal BFF (configure-app.ts).
 */
const clientAddressOf = (request: Request): string => request.ip ?? 'unknown';

/** Sets `Retry-After` on a rate-limited answer, then answers as usual. */
function answerLimited<T>(
  response: Response,
  result: Result<T, { readonly code: string; readonly retryAfterSeconds?: number }>,
): T {
  if (!result.ok && result.error.retryAfterSeconds !== undefined) {
    response.setHeader('Retry-After', String(result.error.retryAfterSeconds));
  }
  return answer(result);
}

const COOKIE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/**
 * Portal sign-in with one-time codes (ADR-0026), for the portal BFF: the options of the
 * tenant, a CAPTCHA challenge, a code sent to an address, the code's check that starts the
 * session (cookie `__Host-phoenix-portal`), the signed-in user and sign-out.
 */
@ApiTags('identity (portal)')
@Controller('identity/portal')
export class PortalSignInController {
  readonly #logger = new Logger('PortalSignIn');

  constructor(
    private readonly options: ViewPortalSignInOptions,
    private readonly challenge: IssuePortalChallenge,
    private readonly requestCode: RequestPortalCode,
    private readonly verifyCode: VerifyPortalCode,
    private readonly viewOwn: ViewOwnPortalAccount,
    private readonly signOut: SignOut,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('sign-in-options')
  async signInOptions(@Call() context: CallContext) {
    return answer(await this.options.execute(context, undefined));
  }

  @Post('challenge')
  @HttpCode(200)
  async issueChallenge(
    @Call() context: CallContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return answerLimited(
      response,
      await this.challenge.execute(context, { clientAddress: clientAddressOf(request) }),
    );
  }

  /** Sends a code; the same answer whether or not the address has an account. */
  @Post('code')
  @HttpCode(200)
  async code(
    @Call() context: CallContext,
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(codeBody, body);
    const sent = answerLimited(
      response,
      await this.requestCode.execute(context, {
        ...input,
        clientAddress: clientAddressOf(request),
      }),
    );
    return { challengeId: sent.challengeId, expiresAt: sent.expiresAt.toString() };
  }

  /** Checks the code and starts the session: the cookie, and the CSRF token in the body. */
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Call() context: CallContext,
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.verifyCode.execute(context, {
      ...parseRequest(signInBody, body),
      clientAddress: clientAddressOf(request),
    });
    if (!result.ok) {
      // The reason code only: never the address or the code.
      this.#logger.warn({
        msg: 'identity.portal-sign-in.refused',
        reason: result.error.code,
        tenantId: context.tenant.tenantId,
        correlationId: context.correlationId,
      });
    }
    const session = answerLimited(response, result);
    response.cookie(PORTAL_SESSION_COOKIE, session.sessionToken, {
      ...COOKIE,
      expires: new Date(session.expiresAt.epochMilliseconds),
    });
    return {
      accountId: session.accountId,
      expiresAt: session.expiresAt.toString(),
      csrfToken: csrfTokenOf(this.config.session.secret, session.sessionToken),
    };
  }

  /** The signed-in portal user, and the CSRF token of the session the request carried. */
  @Get('me')
  async me(@Call() context: CallContext, @Req() request: IncomingMessage) {
    const account = answer(await this.viewOwn.execute(context, undefined));
    const token = cookieValue(request.headers.cookie, PORTAL_SESSION_COOKIE) ?? '';
    return { ...account, csrfToken: csrfTokenOf(this.config.session.secret, token) };
  }

  @Post('sign-out')
  @HttpCode(204)
  async end(
    @Call() context: CallContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    answer(await this.signOut.execute(context, undefined));
    response.clearCookie(PORTAL_SESSION_COOKIE, COOKIE);
  }
}
