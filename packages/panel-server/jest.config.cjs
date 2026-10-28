/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'src/.*\\.spec\\.ts$',
  // Specs run as CommonJS; the package itself is consumed as ESM source by the panels.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true } }],
  },
  moduleNameMapper: {
    '^@phoenix/shared-kernel$': '<rootDir>/../shared-kernel/src/index.ts',
  },
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  ...(process.env.GITHUB_ACTIONS ? { testTimeout: 30_000 } : {}),
};
