import { STUDIO_MENU } from '../menu';
import { fill, isMessageKey, messagesFor } from './messages';

describe('messagesFor', () => {
  it('picks the texts by the language of the tenant locale', () => {
    expect(messagesFor('fa-IR')['accounts.title']).toBe('کاربران');
    expect(messagesFor('en-CA')['accounts.title']).toBe('Users');
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

  it('labels every menu entry from the texts', () => {
    const labels = (entries: typeof STUDIO_MENU): string[] =>
      entries.flatMap((e) => [e.label, ...labels(e.children ?? [])]);
    for (const label of labels(STUDIO_MENU))
      expect([label, isMessageKey(label)]).toEqual([label, true]);
  });
});

describe('fill', () => {
  it('replaces named placeholders and leaves unknown ones', () => {
    expect(fill('سایت {name} و {other}', { name: 'تهران' })).toBe('سایت تهران و {other}');
  });
});
