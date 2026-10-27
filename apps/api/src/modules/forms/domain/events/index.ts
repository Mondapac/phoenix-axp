import { defineEvent, eventField } from '@phoenix/shared-kernel';
import { SUBMISSION_CHANNELS } from '../submission';

// The events of the forms module (ADR-0006). Ids and codes only: the answers are personal data
// and never leave the module in an event (they stay sealed under the submission's key).

/**
 * A form submission was stored (slice 2.6): the process module starts the process the form
 * starts, if any. Version 1 of the submission aggregate; it is written in the submission's unit.
 */
export const FORM_SUBMISSION_RECEIVED = defineEvent({
  type: 'forms.submission-received.v1',
  aggregateType: 'form-submission',
  payload: {
    formId: eventField.id(),
    revisionId: eventField.id(),
    siteId: eventField.id(),
    channel: eventField.enumOf(SUBMISSION_CHANNELS),
  },
});

export const FORMS_EVENTS = [FORM_SUBMISSION_RECEIVED] as const;
