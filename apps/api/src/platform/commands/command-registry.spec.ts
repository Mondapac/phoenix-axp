import {
  CommandRegistry,
  CommandRegistryError,
  registerCommandsFrom,
  type OperatorCommandDefinition,
} from './command-registry';

const command = (name: string): OperatorCommandDefinition => ({
  name,
  usage: '',
  run: () => Promise.resolve(0),
});

describe('CommandRegistry', () => {
  it('holds the commands a module registers, by name, and lists them sorted', () => {
    const registry = new CommandRegistry();
    registry.register('identity', [command('identity.z-command'), command('identity.a-command')]);

    expect(registry.get('identity.a-command')?.name).toBe('identity.a-command');
    expect(registry.get('identity.unknown')).toBeUndefined();
    expect(registry.names()).toEqual(['identity.a-command', 'identity.z-command']);
  });

  it.each([
    ['another module', 'tenancy.seed'],
    ['no command segment', 'identity'],
    ['upper case', 'identity.Seed'],
    ['a third segment', 'identity.seed.admin'],
  ])('fails boot on a name with %s', (_case, name) => {
    expect(() => new CommandRegistry().register('identity', [command(name)])).toThrow(
      CommandRegistryError,
    );
  });

  it('fails boot on a duplicate', () => {
    const registry = new CommandRegistry();
    registry.register('identity', [command('identity.seed')]);
    expect(() => registry.register('identity', [command('identity.seed')])).toThrow(
      /registered twice/,
    );
  });

  it('refuses a registration once the application has bootstrapped', () => {
    const registry = new CommandRegistry();
    registry.onApplicationBootstrap();
    expect(() => registry.register('identity', [command('identity.seed')])).toThrow(/sealed/);
  });

  it('builds a provider that registers the commands from its dependencies', () => {
    const registry = new CommandRegistry();
    const provider = registerCommandsFrom('identity', ['DEP'], (dep: string) => [
      command(`identity.${dep}`),
    ]) as { inject: unknown[]; useFactory: (...args: unknown[]) => unknown };

    expect(provider.inject).toEqual([CommandRegistry, 'DEP']);
    expect(provider.useFactory(registry, 'seed')).toBe('identity');
    expect(registry.names()).toEqual(['identity.seed']);
  });
});
