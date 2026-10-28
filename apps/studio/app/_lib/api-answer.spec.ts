import { messagesFor } from '../_i18n/messages';
import { failureMessage } from './api-answer';

describe('failureMessage', () => {
  it('maps the identity refusals to their texts', () => {
    expect(failureMessage({ status: 409, code: 'identity.account.username-taken' })).toBe(
      'error.usernameTaken',
    );
    expect(failureMessage({ status: 409, code: 'member.last-holder' })).toBe('error.lastHolder');
    expect(failureMessage({ status: 409, code: 'conflict.stale' })).toBe('error.stale');
    expect(failureMessage({ status: 403, code: 'csrf.invalid' })).toBe('error.signedOut');
  });

  it('maps the tenancy refusals to their texts', () => {
    expect(failureMessage({ status: 409, code: 'tenancy.site.slug-taken' })).toBe(
      'error.slugTaken',
    );
    expect(failureMessage({ status: 409, code: 'tenancy.site-domain.taken' })).toBe(
      'error.domainTaken',
    );
    expect(failureMessage({ status: 422, code: 'tenancy.tree.depth-exceeded' })).toBe(
      'error.depthExceeded',
    );
    expect(failureMessage({ status: 422, code: 'tenancy.tree.move-into-own-subtree' })).toBe(
      'error.moveIntoSubtree',
    );
    for (const code of [
      'tenancy.site.not-found',
      'tenancy.organization.not-found',
      'tenancy.site-domain.not-found',
    ]) {
      expect(failureMessage({ status: 404, code })).toBe('error.notFound');
    }
    expect(failureMessage({ status: 400, code: 'tenancy.value.invalid' })).toBe('error.invalid');
  });

  it('never says why GrantPolicy refused: scope and rank read the same', () => {
    expect(failureMessage({ status: 403, code: 'role.not-grantable' })).toBe(
      failureMessage({ status: 403, code: 'member.outranks-actor' }),
    );
  });

  it('reads an unknown 400 as invalid input and anything else as the generic failure', () => {
    expect(failureMessage({ status: 400, code: 'request.invalid' })).toBe('error.invalid');
    expect(failureMessage({ status: 500, code: null })).toBe('error.generic');
    expect(failureMessage({ status: 0, code: null })).toBe('error.generic');
    expect(failureMessage({ status: 409, code: 'toString' })).toBe('error.generic');
  });

  it.each(['fa-IR', 'en-CA'])('has a text in %s for every answer', (locale) => {
    const t = messagesFor(locale);
    for (const code of [
      'member.self',
      'identity.role.key-taken',
      'access.denied',
      'tenancy.site.slug-taken',
      'tenancy.site-domain.taken',
      'tenancy.tree.depth-exceeded',
      'tenancy.tree.move-into-own-subtree',
    ]) {
      expect(t[failureMessage({ status: 409, code })]).toBeTruthy();
    }
  });
});
