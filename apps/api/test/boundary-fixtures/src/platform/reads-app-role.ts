// Violation: only main.ts and platform/worker/ read appRole.
declare const config: { appRole: string };

export function violates(): unknown[] {
  return [config.appRole, config.appRole === 'worker'];
}
