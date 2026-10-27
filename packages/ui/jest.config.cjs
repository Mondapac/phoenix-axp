/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  testRegex: 'src/.*\\.spec\\.tsx?$',
  // Specs run as CommonJS; the package itself is consumed as ESM source by the panels.
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { jsx: 'react-jsx', module: 'commonjs', esModuleInterop: true } },
    ],
  },
  moduleNameMapper: {
    '^@phoenix/shared-kernel/persian-text$': '<rootDir>/../shared-kernel/src/persian-text.ts',
    '^@phoenix/shared-kernel$': '<rootDir>/../shared-kernel/src/index.ts',
  },
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  ...(process.env.GITHUB_ACTIONS ? { testTimeout: 30_000 } : {}),
};
