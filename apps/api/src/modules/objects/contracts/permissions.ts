import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the objects module (ADR-0017 decision 6). Designing and publishing a
// definition are separate keys (phase 2 review, D7). Every key but the protected one is site
// scope (ADR-0018 decision 6): each use case checks the definition's or the record's site
// against the grants conferring the key.

export const OBJECTS_DEFINITIONS_VIEW = definePermission('objects', {
  key: 'objects.definitions.view',
  scope: 'site',
  protected: false,
});

/** Create definitions, rename them and save revisions. */
export const OBJECTS_DEFINITIONS_DESIGN = definePermission('objects', {
  key: 'objects.definitions.design',
  scope: 'site',
  protected: false,
});

/** Publish a revision of a definition and retire a definition. */
export const OBJECTS_DEFINITIONS_PUBLISH = definePermission('objects', {
  key: 'objects.definitions.publish',
  scope: 'site',
  protected: false,
});

/**
 * Save a revision in which a field that was sensitive is not any more (ADR-0024 decision 4).
 * Granted only by a system-role holder.
 */
export const OBJECTS_DEFINITIONS_LOWER_SENSITIVITY = definePermission('objects', {
  key: 'objects.definitions.lower-sensitivity',
  scope: 'tenant',
  protected: true,
});

// Keys over records are held per role with a definition qualifier (ADR-0024 decision 2): the
// definition ids they apply to, or all. Field modes come from the role's field rules.

/** Read records: the values the actor's field modes show. */
export const OBJECTS_RECORD_READ = definePermission('objects', {
  key: 'objects.record.read',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

/** Create records; gives `edit` on every field unless a rule narrows it. */
export const OBJECTS_RECORD_CREATE = definePermission('objects', {
  key: 'objects.record.create',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

export const OBJECTS_RECORD_UPDATE = definePermission('objects', {
  key: 'objects.record.update',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

/** Delete a record; its subject key is destroyed with it. */
export const OBJECTS_RECORD_DELETE = definePermission('objects', {
  key: 'objects.record.delete',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

export const OBJECTS_PERMISSIONS = declarePermissions('objects', [
  OBJECTS_DEFINITIONS_VIEW,
  OBJECTS_DEFINITIONS_DESIGN,
  OBJECTS_DEFINITIONS_PUBLISH,
  OBJECTS_DEFINITIONS_LOWER_SENSITIVITY,
  OBJECTS_RECORD_READ,
  OBJECTS_RECORD_CREATE,
  OBJECTS_RECORD_UPDATE,
  OBJECTS_RECORD_DELETE,
]);
