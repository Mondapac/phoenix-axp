import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import { matchSignIn, parseUsername, type Account } from './account';

const id = (n: number): Id<'Account'> => {
  const parsed = parseId<'Account'>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};

const account = (overrides: Partial<Account>): Account => ({
  id: id(1),
  population: 'tenant-staff',
  source: 'local',
  subject: null,
  username: 'sara',
  status: 'active',
  version: 1,
  ...overrides,
});

// Pure rules: the same in every tenant, checked in both fixtures (working rule 5).
describe.each(TEST_TENANTS)('the staff account rules (tenant %s)', () => {
  describe('parseUsername', () => {
    it('stores the name trimmed and in lower case', () => {
      expect(parseUsername('  Sara.Ahmadi@Org ')).toEqual({ ok: true, value: 'sara.ahmadi@org' });
    });

    it.each(['', ' ', 'two words', '-lead', 'سارا', 'a'.repeat(256)])('refuses %j', (value) => {
      expect(parseUsername(value)).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'username' },
      });
    });
  });

  describe('matchSignIn (ADR-0019 decision 3)', () => {
    const directory = { subject: 's-1', username: 'sara', directory: true };
    const local = { subject: 's-1', username: 'sara', directory: false };

    it('signs a known subject in to its account when the source agrees', () => {
      const known = account({ source: 'directory', subject: 's-1' });
      expect(matchSignIn(directory, known, known)).toEqual({ kind: 'existing', account: known });
      expect(matchSignIn(local, known, known)).toEqual({
        kind: 'refused',
        reason: 'source-mismatch',
      });
    });

    it('provisions a directory user unless the username is taken', () => {
      expect(matchSignIn(directory, null, null)).toEqual({ kind: 'create-directory' });
      expect(matchSignIn(directory, null, account({}))).toEqual({
        kind: 'refused',
        reason: 'source-mismatch',
      });
    });

    it('links a local user only to the never-used local account of its username', () => {
      const pending = account({});
      expect(matchSignIn(local, null, pending)).toEqual({ kind: 'link-local', account: pending });
      expect(matchSignIn(local, null, null)).toEqual({ kind: 'refused', reason: 'no-account' });
      expect(matchSignIn(local, null, account({ subject: 's-2' }))).toEqual({
        kind: 'refused',
        reason: 'no-account',
      });
      expect(matchSignIn(local, null, account({ source: 'directory', subject: 's-2' }))).toEqual({
        kind: 'refused',
        reason: 'no-account',
      });
    });
  });
});
