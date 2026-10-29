import type { Id } from '@phoenix/shared-kernel';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { PortalCodes } from './portal-codes';
import { codeMessage } from './portal-messages';

const id = (n: number) =>
  `01990000-0000-7000-8000-${String(n).padStart(12, '0')}` as Id<'PortalCode'>;

describe.each(TEST_TENANTS)('portal codes in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const other = testTenantContext(TEST_TENANTS.find((c) => c !== code)!);
  const codes = new PortalCodes(Buffer.alloc(32, 3));

  it('issues six random digits', () => {
    const issued = new Set(Array.from({ length: 200 }, () => codes.issue()));
    for (const value of issued) expect(value).toMatch(/^[0-9]{6}$/);
    expect(issued.size).toBeGreaterThan(190);
  });

  it('binds the hash to the code, the challenge and the tenant', () => {
    const hash = codes.hash(tenant, id(1), '012345')!;
    expect(PortalCodes.matches(hash, codes.hash(tenant, id(1), '012345'))).toBe(true);
    for (const candidate of [
      codes.hash(tenant, id(1), '012346'),
      codes.hash(tenant, id(2), '012345'),
      codes.hash(other, id(1), '012345'),
      new PortalCodes(Buffer.alloc(32, 4)).hash(tenant, id(1), '012345'),
      codes.hash(tenant, id(1), '12345'),
      codes.hash(tenant, id(1), '۰۱۲۳۴۵'),
    ]) {
      expect(PortalCodes.matches(hash, candidate)).toBe(false);
    }
  });
});

describe('the code message', () => {
  it('is in the tenant language, English otherwise, with ASCII digits', () => {
    expect(codeMessage('fa-IR', 'پورتال نمونه', '012345').text).toContain('پورتال نمونه: 012345');
    expect(codeMessage('en-GB', 'Demo', '012345').subject).toBe('Your Demo sign-in code');
    expect(codeMessage('ar', 'Demo', '012345').text).toContain('valid for 5 minutes');
  });
});
