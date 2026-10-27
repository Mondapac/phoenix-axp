// Allowed: the entry point reads appRole.
declare const config: { appRole: string };

export const role = config.appRole;
