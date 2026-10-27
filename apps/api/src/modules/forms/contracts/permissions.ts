import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the forms module (Phoenix ADR-0004 decision 6). Designing and publishing
// are separate keys, as for processes (phase 2 review, D7): a designer drafts revisions, a
// publisher decides which one citizens see. Tenant scope for now: a site-scope key needs the
// actor's grants to check the form's site with `grantCoversSite`, and no module can read them
// yet; a later slice may narrow form management to a site subtree (ADR-0018 decision 6).

export const FORMS_FORMS_VIEW = definePermission('forms', {
  key: 'forms.forms.view',
  scope: 'tenant',
  protected: false,
});

/** Create forms, change their settings and save revisions. */
export const FORMS_FORMS_DESIGN = definePermission('forms', {
  key: 'forms.forms.design',
  scope: 'tenant',
  protected: false,
});

/** Publish a revision of a form and retire a form. */
export const FORMS_FORMS_PUBLISH = definePermission('forms', {
  key: 'forms.forms.publish',
  scope: 'tenant',
  protected: false,
});

export const FORMS_PERMISSIONS = declarePermissions('forms', [
  FORMS_FORMS_VIEW,
  FORMS_FORMS_DESIGN,
  FORMS_FORMS_PUBLISH,
]);
