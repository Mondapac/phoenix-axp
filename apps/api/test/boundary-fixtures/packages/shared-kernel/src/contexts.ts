// The `/contexts` entry of the miniature kernel: the actor and call-context constructors and
// types, which only platform/ may import (contexts-are-built-by-platform). tsconfig.json maps
// @phoenix/shared-kernel/contexts here, so the fixtures resolve without the real entry.
export type ActorContext = AnonymousActor | SystemActor | AuthenticatedActor;
export interface AnonymousActor {
  readonly kind: 'anonymous';
}
export interface SystemActor {
  readonly kind: 'system';
  readonly tenantId?: string;
}
export interface AuthenticatedActor {
  readonly kind: 'authenticated';
}
export interface CallContext {
  readonly actor: ActorContext;
}
export const anonymousActor = (): AnonymousActor => ({ kind: 'anonymous' });
export const systemActor = (tenant?: { readonly tenantId: string }): SystemActor =>
  tenant ? { kind: 'system', tenantId: tenant.tenantId } : { kind: 'system' };
export const createCallContext = (actor: ActorContext): CallContext => ({ actor });
