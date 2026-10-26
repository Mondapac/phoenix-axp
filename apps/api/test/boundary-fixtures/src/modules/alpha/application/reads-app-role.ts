// Violation: a module never reads the process role.
declare const config: { appRole: string };

export function violates(): string {
  return config.appRole;
}
