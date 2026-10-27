/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: {
    // Every entry maps to the kernel's sources, so tests load one copy of the kernel, as the
    // built API loads one copy of its dist/.
    '^@phoenix/shared-kernel$': '<rootDir>/../../packages/shared-kernel/src/index.ts',
    // Fakes and builders.
    '^@phoenix/shared-kernel/testing$': '<rootDir>/../../packages/shared-kernel/src/testing.ts',
    // The actor and call-context constructors: platform entry adapters only.
    '^@phoenix/shared-kernel/contexts$': '<rootDir>/../../packages/shared-kernel/src/contexts.ts',
    // The authenticated-actor constructor: identity's Authenticator only (Phase 1).
    '^@phoenix/shared-kernel/authenticated-actor$':
      '<rootDir>/../../packages/shared-kernel/src/authenticated-actor.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  // In CI, also report each failed test as a GitHub annotation.
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  // Shared CI runners are slower than a laptop; locally the default stays, so a test that really
  // got slow still shows up there.
  ...(process.env.GITHUB_ACTIONS ? { testTimeout: 30_000 } : {}),
  // Restart a worker between spec files once it holds more than 1 GB, so a growing suite cannot
  // cross the heap limit ("Jest worker ran out of memory").
  workerIdleMemoryLimit: '1GB',
};
