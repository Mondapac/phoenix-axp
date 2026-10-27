import { Global, Module } from '@nestjs/common';
import { CommandRegistry } from './command-registry';

/** The registry of operator commands, which modules register with (command-registry.ts). */
@Global()
@Module({
  providers: [CommandRegistry],
  exports: [CommandRegistry],
})
export class CommandsModule {}
