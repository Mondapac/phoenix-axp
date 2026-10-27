// Adapted from the LastHolderPolicy cases of Mondapac
// apps/api/src/modules/identity/domain/grant-policy.spec.ts (identity design 5.5).
import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { LastHolderPolicy } from './last-holder-policy';

const account = (n: number): Id<'Account'> => {
  const parsed = parseId<'Account'>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};
const A = account(1);
const B = account(2);

describe('LastHolderPolicy', () => {
  it('refuses losing the only holder of the system role of a tenant', () => {
    expect(LastHolderPolicy.wouldLeaveNoHolder([A], A)).toBe(true);
    expect(LastHolderPolicy.allowsLosing([A, A], A)).toEqual({
      ok: false,
      error: { code: 'member.last-holder' },
    });
  });

  it('allows losing one of two holders, and an account that holds nothing', () => {
    expect(LastHolderPolicy.allowsLosing([A, B], A)).toEqual({ ok: true, value: undefined });
    expect(LastHolderPolicy.allowsLosing([A], B).ok).toBe(true);
    expect(LastHolderPolicy.allowsLosing([], A).ok).toBe(true);
  });
});
