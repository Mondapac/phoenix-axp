// The main entry of a miniature shared kernel. tsconfig.json maps @phoenix/shared-kernel
// here and @phoenix/shared-kernel/testing to testing.ts, as apps/api/tsconfig.json does.
export { mintTenantContext } from './tenant-context';
export type { TenantContext } from './tenant-context';
export { isMinted } from './minted';

// Violation (kernel-testing-only-in-tests): the main entry carries a fake.
export { FixedClock } from './testing';
