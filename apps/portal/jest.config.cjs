/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  testRegex: 'app/.*\\.spec\\.tsx?$',
  // Specs run as CommonJS over the portal's pure and server modules; the screens are checked in
  // a browser (README portal section).
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { jsx: 'react-jsx', module: 'commonjs', esModuleInterop: true } },
    ],
  },
  moduleNameMapper: {
    '^@phoenix/shared-kernel$': '<rootDir>/../../packages/shared-kernel/src/index.ts',
  },
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  ...(process.env.GITHUB_ACTIONS ? { testTimeout: 30_000 } : {}),
};
