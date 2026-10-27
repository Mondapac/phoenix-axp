# ADR-0009: Licence Policy and Proprietary Product

**Status:** Accepted — 2026-10-26 (owner decision: proprietary product; no GPL or AGPL)
**Relates to:** ADR-0005, ADR-0012, ADR-0014

## Context
Phoenix AXP is sold as a proprietary product, on-premise and as SaaS. Copyleft or source-available
licences in the product would force disclosure or restrict SaaS use.

## Decision
1. **Allowed** for product dependencies: MIT, Apache-2.0, BSD (2- and 3-clause) and ISC.
2. **Forbidden:** GPL, LGPL, AGPL, SSPL, BUSL and "Sustainable Use" or similar licences.
   Anything else needs `cto` approval and an ADR.
3. **CI check:** `pnpm verify` runs a licence check over the full dependency tree; an unknown or
   forbidden licence fails the build.
4. **New dependency = its own small PR** stating the licence and why it is needed; install
   scripts are disabled by default.
5. **Separate copyleft services** (run as an unmodified separate process) only with legal
   approval recorded in an ADR.
6. **Bundled services:** Keycloak, Flowable OSS and SeaweedFS are Apache-2.0; bpmn-js keeps its
   visible watermark per the bpmn.io licence.

## Consequences
- Some popular tools are excluded (e.g. MinIO, AGPL); alternatives are chosen per ADR.
- Licence drift in transitive dependencies is caught by CI, not by review.
- Common permissive variants in transitive or dev-only dependencies (0BSD, CC0-1.0, BlueOak,
  CC-BY-4.0 data files, MPL-2.0) are outside the closed list; whether to allow them, and for
  dev-only tooling only, is an open owner question for the Phase 1 review. Until then CI lists
  them as failures and `cto` approves each one explicitly.

## Alternatives considered
- Allowing LGPL with dynamic linking: legal ambiguity in JavaScript bundles; rejected.
