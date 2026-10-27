// Violation: the composition root binds a module on its behalf.
import { registerPermissions } from './modules/content/platform-stubs';

declare const catalogue: unknown[];

export const permissions = registerPermissions('content', catalogue);
