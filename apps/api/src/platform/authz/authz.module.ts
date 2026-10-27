// Ported from Mondapac apps/api/src/platform/authz/authz.module.ts. Phoenix changes: the step-up
// guard and registry are not ported (Mondapac's seller OTP policy; MFA is Keycloak's, ADR-0004
// decision 1); the authorisation check and the site-ancestry reader each come from the module
// that implements them, and while that module does not exist, from a fail-closed placeholder
// (ADR-0010 decision 2).
import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { AUTHENTICATOR } from './authenticator';
import { AUTHORISATION_CHECK, type AuthorisationCheck } from './authorisation-check';
import { PERMISSION_KEY_LOOKUP } from './permission-key-lookup';
import { PermissionRegistry } from './permission-registry';
import { FailClosedAuthenticator } from './placeholders/fail-closed-authenticator';
import { FailClosedAuthorisationCheck } from './placeholders/fail-closed-authorisation-check';
import { FailClosedSiteAncestryReader } from './placeholders/fail-closed-site-ancestry-reader';
import { SITE_ANCESTRY_READER } from './site-scope';
import { createUseCaseGate } from './use-case-gate';
import { USE_CASE_GATE } from './use-case-gate.token';

/**
 * Where the three ports of `platform/authz` come from. Each is a Nest module that provides and
 * exports the token (`AUTHENTICATOR` and `AUTHORISATION_CHECK` from identity,
 * `SITE_ANCESTRY_READER` from tenancy),
 * passed by `app.module.ts`, so `platform/` imports no module. Absent, the fail-closed
 * placeholder is bound, and a production start is refused (ADR-0010 decision 4).
 */
export interface AuthzBindings {
  readonly authentication?: Type;
  readonly authorisation?: Type;
  readonly siteAncestry?: Type;
}

/**
 * The access-rule mechanism (Phoenix ADR-0004 decisions 4 to 7). Global, like the other
 * platform runtime modules: every module's use cases take the gate through
 * {@link USE_CASE_GATE}. This provider is the only place a running process builds a gate (M1).
 *
 * It also holds the {@link PermissionRegistry}, into which every module pushes its catalogue at
 * bootstrap, bound as the `PERMISSION_KEY_LOOKUP` of the outbox and audit writers, and the
 * `SITE_ANCESTRY_READER` that subtree grants are decided with (ADR-0018 decision 6).
 */
@Module({})
export class AuthzModule {
  static register(bindings: AuthzBindings = {}): DynamicModule {
    const imports: Type[] = [];
    const placeholders: Provider[] = [];
    // A bound port is re-exported through its module (Nest exports only its own providers or
    // an imported module), a placeholder through its token.
    const reexported: (Type | symbol)[] = [];
    // The ActorGuard (a global guard) injects the authenticator, so it is exported either way.
    if (bindings.authentication === undefined) {
      placeholders.push({ provide: AUTHENTICATOR, useClass: FailClosedAuthenticator });
      reexported.push(AUTHENTICATOR);
    } else {
      imports.push(bindings.authentication);
      reexported.push(bindings.authentication);
    }
    if (bindings.authorisation === undefined) {
      placeholders.push({ provide: AUTHORISATION_CHECK, useClass: FailClosedAuthorisationCheck });
    } else if (bindings.authorisation !== bindings.authentication) {
      imports.push(bindings.authorisation);
    }
    if (bindings.siteAncestry === undefined) {
      placeholders.push({ provide: SITE_ANCESTRY_READER, useClass: FailClosedSiteAncestryReader });
      reexported.push(SITE_ANCESTRY_READER);
    } else {
      imports.push(bindings.siteAncestry);
      reexported.push(bindings.siteAncestry);
    }
    return {
      module: AuthzModule,
      global: true,
      imports,
      providers: [
        // One registry per process, with the checked-in retired list; Nest calls its
        // `onApplicationBootstrap`, which seals it.
        { provide: PermissionRegistry, useFactory: () => new PermissionRegistry() },
        { provide: PERMISSION_KEY_LOOKUP, useExisting: PermissionRegistry },
        ...placeholders,
        {
          provide: USE_CASE_GATE,
          inject: [TenantRegistry, PermissionRegistry, AUTHORISATION_CHECK],
          useFactory: (
            tenants: TenantRegistry,
            permissions: PermissionRegistry,
            authorisation: AuthorisationCheck,
          ) => createUseCaseGate(tenants, permissions, authorisation),
        },
      ],
      exports: [USE_CASE_GATE, PermissionRegistry, PERMISSION_KEY_LOOKUP, ...reexported],
    };
  }
}
