import * as authenticated from './authenticated-actor';
import * as contexts from './contexts';
import * as kernel from './index';
import * as testing from './testing';

describe('the public surface of the kernel', () => {
  it('exports exactly these names from the main entry', () => {
    expect(Object.keys(kernel).sort()).toEqual([
      'AUDIT_ACTOR_KINDS',
      'BOUND_SUBJECT_FIELD',
      'CONTENT_HASH_PATTERN',
      'ContextMismatchError',
      'MAX_AGGREGATE_VERSION',
      'MAX_AUDIT_LIST_LENGTH',
      'MAX_CANONICAL_JSON_DEPTH',
      'POPULATIONS',
      'Temporal',
      'auditField',
      'canonicalJson',
      'checkAggregateVersion',
      'defineAuditAction',
      'defineEvent',
      'describeAuditAction',
      'describeEventDefinition',
      'encodeAuditFields',
      'encodePayload',
      'err',
      'eventField',
      'isAuditActionDefinition',
      'isMinted',
      'mintTenantContext',
      'ok',
      'parseContentHash',
      'parseCorrelationId',
      'parseId',
      'parseTenantId',
      'uuidV7',
    ]);
  });

  it('has no default export', () => {
    expect(kernel).not.toHaveProperty('default');
    expect(testing).not.toHaveProperty('default');
  });

  it('does not export the internal mint functions', () => {
    for (const entry of [kernel, testing, contexts, authenticated]) {
      expect(entry).not.toHaveProperty('mint');
      expect(entry).not.toHaveProperty('mintAuthenticatedActor');
    }
  });

  it('keeps the actor and call-context constructors on the /contexts entry only', () => {
    expect(Object.keys(contexts).sort()).toEqual([
      'anonymousActor',
      'createCallContext',
      'systemActor',
    ]);
    expect(contexts).not.toHaveProperty('default');
    for (const name of Object.keys(contexts)) {
      expect(kernel).not.toHaveProperty(name);
      expect(testing).not.toHaveProperty(name);
    }
  });

  it('keeps the authenticated-actor constructor on its own entry only', () => {
    expect(Object.keys(authenticated)).toEqual(['authenticatedActor']);
    expect(authenticated).not.toHaveProperty('default');
    for (const entry of [kernel, testing, contexts]) {
      expect(entry).not.toHaveProperty('authenticatedActor');
    }
  });

  it('keeps the fakes and builders on the testing entry only', () => {
    expect(Object.keys(testing).sort()).toEqual([
      'FixedClock',
      'SequenceIdGenerator',
      'TEST_CORRELATION_ID',
      'testAuthenticatedActor',
      'testCallContext',
      'testTenantContext',
    ]);
    for (const name of Object.keys(testing)) expect(kernel).not.toHaveProperty(name);
  });
});
