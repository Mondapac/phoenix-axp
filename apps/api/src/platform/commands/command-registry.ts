import {
  Injectable,
  type InjectionToken,
  type OnApplicationBootstrap,
  type Provider,
} from '@nestjs/common';
import type { CallContext, SystemActor } from '@phoenix/shared-kernel';

/**
 * What an operator command receives: a minted `CallContext` of the one tenant named on the
 * command line, its system actor and a new correlation id, built by the runner
 * (run-operator-command.ts), never by the command. As for a job (job-registry.ts), the type
 * requires the system actor, so the command calls `system` use cases only.
 */
export type CommandContext = CallContext & { readonly actor: SystemActor };

/**
 * An operator command of the api image (`run-command <module>.<command> --tenant <id> ...`),
 * declared in the owning module's `presentation/commands/` and registered with
 * {@link registerCommandsFrom}. `run` reads its own arguments (the ones after `--tenant <id>`),
 * calls use cases and answers the process exit code: 0 for success, 1 for a refusal; other
 * codes are the command's own and documented on it. It writes through `write` only lines that
 * never echo operator input, personal data or an error message.
 */
export interface OperatorCommandDefinition {
  /** `<module>.<command>`. */
  readonly name: string;
  /** The arguments after `--tenant <id>`, for the usage line. */
  readonly usage: string;
  run(
    context: CommandContext,
    argv: readonly string[],
    write: (line: string) => void,
  ): Promise<number>;
}

const COMMAND_NAME = /^([a-z][a-z0-9-]*)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Registration refused at boot. */
export class CommandRegistryError extends Error {
  override readonly name = 'CommandRegistryError';
}

/**
 * Every operator command of the application. As the job registry: the first segment of a name
 * is the registering module, a duplicate fails boot, and the registry is sealed when the
 * application has bootstrapped.
 */
@Injectable()
export class CommandRegistry implements OnApplicationBootstrap {
  readonly #commands = new Map<string, OperatorCommandDefinition>();
  #sealed = false;

  register(module: string, commands: readonly OperatorCommandDefinition[]): void {
    if (this.#sealed) throw new CommandRegistryError('The command registry is sealed');
    for (const command of commands) {
      const name = COMMAND_NAME.exec(command.name);
      if (name === null || name[1] !== module) {
        throw new CommandRegistryError(
          `Module "${module}" cannot register the command "${command.name}"`,
        );
      }
      if (this.#commands.has(command.name)) {
        throw new CommandRegistryError(`The command "${command.name}" is registered twice`);
      }
      this.#commands.set(command.name, command);
    }
  }

  seal(): void {
    this.#sealed = true;
  }

  onApplicationBootstrap(): void {
    this.seal();
  }

  get(name: string): OperatorCommandDefinition | undefined {
    return this.#commands.get(name);
  }

  /** The names of every command, sorted. */
  names(): string[] {
    return [...this.#commands.keys()].sort();
  }
}

/**
 * The one line of a module's Nest module that registers its commands: `build` receives the
 * providers named in `inject`, in order (use cases), and returns the module's commands.
 */
export function registerCommandsFrom(
  module: string,
  inject: readonly InjectionToken[],
  build: (...dependencies: never[]) => readonly OperatorCommandDefinition[],
): Provider {
  return {
    provide: Symbol(`commands:${module}`),
    inject: [CommandRegistry, ...inject],
    useFactory: (registry: CommandRegistry, ...dependencies: never[]) => {
      registry.register(module, build(...dependencies));
      return module;
    },
  };
}
