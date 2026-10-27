import type { Request, Response } from 'express';
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { IssueSubmissionChallenge } from '../application/use-cases/issue-submission-challenge.use-case';
import { SubmitFormOnBehalf } from '../application/use-cases/submit-form-on-behalf.use-case';
import { SubmitFormSignedIn } from '../application/use-cases/submit-form-signed-in.use-case';
import { SubmitForm } from '../application/use-cases/submit-form.use-case';
import { TrackSubmission } from '../application/use-cases/track-submission.use-case';
import { ViewPublishedFormSignedIn } from '../application/use-cases/view-published-form-signed-in.use-case';
import { ViewPublishedForm } from '../application/use-cases/view-published-form.use-case';
import { answer, parseRequest } from './http';

const submitBody = z.strictObject({
  // The answers are checked by the use case against the revision's schema.
  answers: z.unknown(),
  captcha: z.string().max(2048).optional(),
  onBehalf: z.boolean().optional(),
});
// The code travels in the body, never in a URL, so it stays out of access logs.
const trackBody = z.strictObject({ trackingCode: z.string().max(64) });
const formKey = z.string().max(64);

/**
 * The client's address, for the rate limits only: the socket's, as `trust proxy` is off
 * (configure-app.ts). Behind the BFF every request shares its address until the BFF forwards
 * the client's (docs/platform-deferred.md).
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

/**
 * The public side of forms (portal and anonymous visitors; phase 2 review, slice 2.5): read a
 * published form, get a CAPTCHA challenge, submit, and follow a submission by its tracking
 * code. A route with a signed-in caller goes to the signed-in use case (the gate gives an
 * `anonymous` use case the anonymous actor whoever calls it); `onBehalf` to the on-behalf one.
 * Each use case decides who it admits.
 */
@ApiTags('forms (public)')
@Controller('public/forms')
export class PublicFormsController {
  constructor(
    private readonly viewPublishedForm: ViewPublishedForm,
    private readonly viewPublishedFormSignedIn: ViewPublishedFormSignedIn,
    private readonly issueChallenge: IssueSubmissionChallenge,
    private readonly submitForm: SubmitForm,
    private readonly submitFormSignedIn: SubmitFormSignedIn,
    private readonly submitFormOnBehalf: SubmitFormOnBehalf,
    private readonly trackSubmission: TrackSubmission,
  ) {}

  @Get('challenge')
  async challenge(
    @Call() context: CallContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return answerLimited(
      response,
      await this.issueChallenge.execute(context, { clientAddress: clientAddressOf(request) }),
    );
  }

  @Post('tracking')
  @HttpCode(200)
  async track(
    @Call() context: CallContext,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { trackingCode } = parseRequest(trackBody, body);
    return answerLimited(
      response,
      await this.trackSubmission.execute(context, {
        trackingCode,
        clientAddress: clientAddressOf(request),
      }),
    );
  }

  @Get(':formKey')
  async view(@Call() context: CallContext, @Param('formKey') key: string) {
    const input = { formKey: parseRequest(formKey, key) };
    return answer(
      context.actor.kind === 'authenticated'
        ? await this.viewPublishedFormSignedIn.execute(context, input)
        : await this.viewPublishedForm.execute(context, input),
    );
  }

  @Post(':formKey/submissions')
  async submit(
    @Call() context: CallContext,
    @Param('formKey') key: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = parseRequest(submitBody, body);
    const input = {
      formKey: parseRequest(formKey, key),
      answers: parsed.answers,
      clientAddress: clientAddressOf(request),
    };
    let result;
    if (parsed.onBehalf === true) result = await this.submitFormOnBehalf.execute(context, input);
    else if (context.actor.kind === 'authenticated') {
      result = await this.submitFormSignedIn.execute(context, input);
    } else {
      result = await this.submitForm.execute(context, {
        ...input,
        ...(parsed.captcha === undefined ? {} : { captcha: parsed.captcha }),
      });
    }
    return answerLimited(response, result);
  }
}
