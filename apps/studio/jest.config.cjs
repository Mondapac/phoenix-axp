/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  testRegex: 'app/.*\\.spec\\.tsx?$',
  // Specs run as CommonJS over the studio's pure and server modules; the screens are checked in
  // a browser (README studio section).
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { jsx: 'react-jsx', module: 'commonjs', esModuleInterop: true } },
    ],
  },
  moduleNameMapper: {
    '^@phoenix/shared-kernel$': '<rootDir>/../../packages/shared-kernel/src/index.ts',
    // `@phoenix/ui` re-exports its inputs, which normalise Persian text through this entry.
    '^@phoenix/shared-kernel/persian-text$':
      '<rootDir>/../../packages/shared-kernel/src/persian-text.ts',
  },
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  ...(process.env.GITHUB_ACTIONS ? { testTimeout: 30_000 } : {}),
};
