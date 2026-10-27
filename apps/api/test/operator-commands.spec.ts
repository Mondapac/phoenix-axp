import type { NestExpressApplication } from '@nestjs/platform-express';
import { CommandRegistry } from '../src/platform/commands/command-registry';
import { createTestApp } from './support/test-app';

// The operator commands of the booted application (platform/commands), sealed at bootstrap.

describe('the operator command registry', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists identity's first-administrator command and is sealed", () => {
    const registry = app.get(CommandRegistry);
    expect(registry.names()).toEqual(['identity.bootstrap-tenant-admin']);
    expect(() => registry.register('identity', [])).toThrow(/sealed/);
  });
});
