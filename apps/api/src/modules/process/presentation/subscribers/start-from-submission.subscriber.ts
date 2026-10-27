import type { Id } from '@phoenix/shared-kernel';
import {
  subscription,
  type RegisteredSubscription,
} from '../../../../platform/events/event-subscriptions';
import { FORM_SUBMISSION_RECEIVED } from '../../../forms';
import type { StartProcessFromSubmission } from '../../application/use-cases/start-process-from-submission.use-case';

/**
 * A stored form submission starts the process its form starts (slice 2.6). Delivery is at
 * least once; the use case's runOnce makes the start happen once per event, and the instance's
 * unique submission id once per submission. A refusal throws, so the delivery comes due again.
 */
export function startFromSubmissionSubscriber(
  start: StartProcessFromSubmission,
): RegisteredSubscription {
  return subscription({
    name: 'process.start-from-submission',
    event: FORM_SUBMISSION_RECEIVED,
    handle: async (event, delivery, context) => {
      const result = await start.execute(context, {
        submission: {
          submissionId: event.aggregateId as Id<'FormSubmission'>,
          formId: event.payload.formId as Id<'Form'>,
          formRevisionId: event.payload.revisionId as Id<'FormRevision'>,
          siteId: event.payload.siteId as Id<'Site'>,
        },
        delivery,
      });
      if (!result.ok) throw new Error(`process.start-from-submission: ${result.error.code}`);
    },
  });
}
