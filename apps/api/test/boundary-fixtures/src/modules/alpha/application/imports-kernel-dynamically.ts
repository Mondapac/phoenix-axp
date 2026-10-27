// Violation: a module has no import(), so a computed member of the kernel's namespace cannot
// reach mintTenantContext.
export const violation = async (): Promise<unknown> =>
  (await import('@phoenix/shared-kernel'))[`mintTenantContext`];
