import { failureMessage } from './api-answer';

describe('failureMessage', () => {
  it('names the problem of each refusal of sign-in', () => {
    expect(failureMessage({ status: 400, code: 'identity.value.invalid' })).toBe(
      'error.invalidAddress',
    );
    expect(failureMessage({ status: 400, code: 'portal.code-invalid' })).toBe('error.invalidCode');
    expect(failureMessage({ status: 403, code: 'portal.account-disabled' })).toBe('error.disabled');
    expect(failureMessage({ status: 503, code: 'portal.delivery-failed' })).toBe(
      'error.unavailable',
    );
    expect(failureMessage({ status: 400, code: 'captcha.invalid' })).toBe('error.captcha');
    expect(failureMessage({ status: 429, code: 'rate-limit.exceeded' })).toBe('error.tooMany');
  });

  it('reads an unknown refusal as the generic failure, and any 429 as too many', () => {
    expect(failureMessage({ status: 500, code: 'something.else' })).toBe('error.generic');
    expect(failureMessage({ status: 0, code: null })).toBe('error.generic');
    expect(failureMessage({ status: 429, code: null })).toBe('error.tooMany');
  });
});
