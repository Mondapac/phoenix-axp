// Server-side helpers of the panels' BFFs (ADR-0001). Import from a panel's server code only:
// route handlers, server components and the panel's proxy, never from a client component.
export {
  PanelConfigError,
  parseTenantHosts,
  readPanelServerConfig,
  tenantOfHost,
  type PanelServerConfig,
} from './config';
export {
  heldKeys,
  visibleMenu,
  type MenuEntry,
  type OwnPermissions,
  type VisibleMenuEntry,
} from './menu';
export {
  apiUrlOf,
  bffAnswer,
  clientAddressOf,
  MAX_BODY_BYTES,
  readFromApi,
  relayToApi,
  type ApiRead,
  type RelayOptions,
} from './relay';
export {
  contentSecurityPolicy,
  newNonce,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
} from './security-headers';
export { beginSignIn, completeSignIn, isIdentityProviderUrl, type SignInOptions } from './sign-in';
