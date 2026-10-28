import { fill, messagesFor } from './messages';

describe('messagesFor', () => {
  it('picks the texts by the language of the tenant locale', () => {
    expect(messagesFor('fa-IR')['account.title']).toBe('حساب من');
    expect(messagesFor('en-CA')['account.title']).toBe('My account');
  });

  it('falls back to English for a language without texts or a malformed tag', () => {
    expect(messagesFor('fr-CA')).toBe(messagesFor('en'));
    expect(messagesFor('not a tag!')).toBe(messagesFor('en'));
  });

  it('has a non-empty text for every key in both languages', () => {
    for (const locale of ['fa-IR', 'en-CA']) {
      for (const [key, text] of Object.entries(messagesFor(locale))) {
        expect([key, text.trim().length > 0]).toEqual([key, true]);
      }
    }
  });

  it('fills named placeholders', () => {
    expect(fill(messagesFor('en-CA')['code.resendIn'], { seconds: '42' })).toBe(
      'Send again in 42 seconds',
    );
  });
});
