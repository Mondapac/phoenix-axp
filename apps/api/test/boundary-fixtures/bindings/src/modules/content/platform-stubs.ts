// Stand-ins for the platform's binding functions, so the fixture needs no real imports.
export declare const PersistenceModule: {
  outboxWriterFor(module: string): unknown;
  auditWriterFor(owner: string): unknown;
};
export declare function registerSubscriptionsFrom(module: string, ...rest: unknown[]): unknown;
export declare function registerAuditActions(module: string, ...rest: unknown[]): unknown;
export declare function registerPermissions(module: string, ...rest: unknown[]): unknown;
export declare function registerJobsFrom(module: string, ...rest: unknown[]): unknown;
