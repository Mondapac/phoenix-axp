import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the forms module (Phoenix ADR-0004 decision 6). Designing and publishing
// are separate keys, as for processes (phase 2 review, D7): a designer drafts revisions, a
// publisher decides which one citizens see. Every key except the protected one is site scope
// (ADR-0018 decision 6): a site role holds it for its site (and the sites below with
// `includeDescendants`), and each use case checks the form's site against the actor's grants.

export const FORMS_FORMS_VIEW = definePermission('forms', {
  key: 'forms.forms.view',
  scope: 'site',
  protected: false,
});

/** Create forms, change their settings and save revisions. */
export const FORMS_FORMS_DESIGN = definePermission('forms', {
  key: 'forms.forms.design',
  scope: 'site',
  protected: false,
});

/** Publish a revision of a form and retire a form. */
export const FORMS_FORMS_PUBLISH = definePermission('forms', {
  key: 'forms.forms.publish',
  scope: 'site',
  protected: false,
});

/**
 * Save a revision in which a field that was sensitive is not any more (ADR-0024 decision 4:
 * "removing `sensitive` needs a protected key"). Granted only by a system-role holder.
 */
export const FORMS_FORMS_LOWER_SENSITIVITY = definePermission('forms', {
  key: 'forms.forms.lower-sensitivity',
  scope: 'tenant',
  protected: true,
});

// Keys over submissions are held per role with a definition qualifier (ADR-0024 decision 2):
// the form ids they apply to, or all forms. Field modes come from the role's field rules.

/** Read the submissions of a form inbox: the answers the actor's field modes show. */
export const FORMS_SUBMISSION_READ = definePermission('forms', {
  key: 'forms.submission.read',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

/**
 * Submit a form on behalf of someone else, where the form allows it; the create key of
 * ADR-0024 decision 7 (it gives `edit` unless a field rule narrows it).
 */
export const FORMS_SUBMISSION_SUBMIT_ON_BEHALF = definePermission('forms', {
  key: 'forms.submission.submit-on-behalf',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

/** Erase the personal data of a submission on request (owner decision D5). */
export const FORMS_SUBMISSION_ERASE = definePermission('forms', {
  key: 'forms.submission.erase',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

export const FORMS_PERMISSIONS = declarePermissions('forms', [
  FORMS_FORMS_VIEW,
  FORMS_FORMS_DESIGN,
  FORMS_FORMS_PUBLISH,
  FORMS_FORMS_LOWER_SENSITIVITY,
  FORMS_SUBMISSION_READ,
  FORMS_SUBMISSION_SUBMIT_ON_BEHALF,
  FORMS_SUBMISSION_ERASE,
]);
