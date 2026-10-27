// Allowed: identity binds its own name.
import { registerPermissions } from '../content/platform-stubs';

declare const catalogue: unknown[];

export const permissions = registerPermissions('identity', catalogue);
