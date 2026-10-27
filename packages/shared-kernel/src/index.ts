// Shared kernel (ADR-01): framework-free building blocks shared by api and the web apps. No
// I/O, no Node API, no framework; `domain/` code may import nothing else.
//
// Result, Id, Clock and Temporal, TenantContext with minting, CorrelationId, the actor and
// CallContext types, DomainEvent with defineEvent and the payload field kinds, and the audit
// pieces (Phoenix ADR-0015): canonicalJson (RFC 8785), ContentHash and defineAuditAction with
// the audit field vocabulary. The constructors of the actor and call contexts are on the `/contexts` entry, for the platform's
// entry adapters only.
//
// Named exports only. Fakes and test builders live on the `/testing` entry and are never
// re-exported from here.
export { err, ok } from './result';
export type { Result } from './result';

export { parseId, uuidV7 } from './id';
export type { Id, IdGenerator } from './id';

export { Temporal } from './time';
export type { Clock } from './time';

export { mintTenantContext, parseTenantId } from './tenant-context';
export type { TenantContext, TenantId } from './tenant-context';

export { parseCorrelationId } from './correlation-id';
export type { CorrelationId } from './correlation-id';

export { isMinted } from './minted';

export { POPULATIONS } from './actor-context';
export type {
  ActorContext,
  AnonymousActor,
  AuthenticatedActor,
  Population,
  SystemActor,
} from './actor-context';

export { ContextMismatchError } from './call-context';
export type { CallContext, ContextMismatchReason } from './call-context';

export {
  checkAggregateVersion,
  defineEvent,
  describeEventDefinition,
  encodePayload,
  eventField,
  MAX_AGGREGATE_VERSION,
} from './domain-event';
export type {
  BooleanKind,
  DomainEvent,
  EnumKind,
  EventDefinition,
  EventDescription,
  EventPayloadError,
  FieldKind,
  FieldValue,
  IdKind,
  InstantKind,
  IntegerKind,
  JsonObject,
  JsonValue,
  ListKind,
  OptionalKind,
  PayloadCheckOptions,
  PayloadFields,
  PayloadOf,
  PendingEvent,
  PermissionKeyKind,
  RecordInput,
} from './domain-event';

export { canonicalJson, MAX_CANONICAL_JSON_DEPTH } from './canonical-json';
export type { CanonicalJsonError } from './canonical-json';

export { CONTENT_HASH_PATTERN, parseContentHash } from './content-hash';
export type { ContentHash, ContentHashError } from './content-hash';

export {
  AUDIT_ACTOR_KINDS,
  auditField,
  BOUND_SUBJECT_FIELD,
  defineAuditAction,
  describeAuditAction,
  encodeAuditFields,
  isAuditActionDefinition,
  MAX_AUDIT_LIST_LENGTH,
} from './audit-action';
export type {
  AuditActionDefinition,
  AuditActionDescription,
  AuditActorKind,
  AuditEntry,
  AuditEntryValues,
  AuditFieldCheckOptions,
  AuditFieldKind,
  AuditFields,
  AuditFieldsError,
  AuditFieldValue,
  AuditListKind,
  AuditOptionalKind,
  AuditPlainKind,
  AuditTargetValue,
  AuditValuesOf,
} from './audit-action';
