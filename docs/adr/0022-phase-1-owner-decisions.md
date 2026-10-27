# ADR-0022: Phase 1 Owner Decisions (P1 to P7)

**Status:** Accepted — 2026-10-27 (owner decisions on cards P1 to P7 of the Phase 1 review)
**Amends:** ADR-0002 (isolation overhead criterion), ADR-0004 decision 3 (AD sync interval),
ADR-0009 (licence allow-list; fonts)
**Relates to:** ADR-0004, ADR-0020, `docs/phases/phase-1-review.md`,
`docs/reviews/poc-1-tenant-isolation.md`, `docs/reviews/poc-2-hybrid-login.md`,
`docs/reviews/poc-4-rtl-portal.md`

## Context
The Phase 1 review put four questions to the owner (cards P1 to P4): how public users sign up,
whether Keycloak keeps one realm per tenant, which UI languages Phase 1 ships, and whether the
ADR-0009 allow-list widens. The Phase 0 PoCs added three more (P5 to P7):
- PoC 1: RLS policies cost within noise, but a transaction per tiny unit of work costs more than
  15% on sub-millisecond reads. ADR-0002 did not say what the criterion measures.
- PoC 2: Keycloak sends nothing when an account is disabled in AD; the core learns it only from
  a periodic sync, so the sync interval is the revocation delay. PoC 2 also ran with one realm
  per tenant, and it worked.
- PoC 4: the Persian font Vazirmatn is under SIL OFL-1.1, which ADR-0009 does not list.

## Decision
Each item is the owner's answer to its card (2026-10-27).
1. **Public sign-up (P1).** Public users (`portal-user`) sign up with a mobile number (one-time
   SMS code) or an email address; each tenant chooses which.
2. **Keycloak realms (P2).** Each tenant gets its own Keycloak realm. Review trigger: more than
   about 200 tenants on one SaaS deployment, decided in a new ADR.
3. **UI languages (P3).** The UI is multilingual. Languages are added and chosen in the admin
   panel, not in code. Phase 1 ships Persian and English.
4. **Licence allow-list (P4), limited widening.** 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0 and
   Python-2.0 join the allow-list and pass without an exception. MPL-2.0 and EPL-2.0 stay
   case-by-case exceptions. The denied families of ADR-0009 are unchanged.
5. **Isolation overhead (P5).** "Overhead under 15%" is measured per request, end to end (tenant
   guard plus RLS against guard alone), not per unit of work. RLS stays.
6. **AD disable delay (P6).** Staff account sync with the directory runs per tenant on a
   configurable interval, default 5 minutes.
7. **Font licence (P7).** SIL OFL-1.1 is allowed for font files only (for example Vazirmatn),
   self-hosted on our own servers; no external font CDN.

## Implementation notes (team defaults, not owner decisions; changeable in review)
- P1: the SMS gateway sits behind a port and each tenant connects its own provider; no default
  provider. Rate limiting and the self-hosted CAPTCHA protect both paths.
- P3: a platform operator installs a language (code, name, direction, default calendar and
  digits) with its translations; each tenant picks which installed languages it offers and its
  default. Missing translations fall back to the tenant's default language.
- P5: the adapter sets the tenant in one statement right after `BEGIN`, and a request reads in as
  few units as practical (ADR-0020).
- P6: studio offers "sync now", a directory change event triggers a sync where the customer can
  send one, and the identity slice fixes a lower and upper bound for the interval.
- P7: until the gate gets a font-only rule, an OFL font package needs a `cto`-approved exception.

## Consequences
- Slices 1.5 and 1.8 build both sign-up paths and the tenant setting; slice 1.5 builds the
  directory sync job and its tenant setting.
- Slice 1.8 (`platform/i18n`) stores languages and translations as data, with the admin screens
  in slice 1.10; every UI string goes through translation keys from day one.
- Slice 1.9 may ship Vazirmatn.
- PoC 1's per-request result meets the criterion; the per-unit numbers stay in the report as
  context.
- The licence gate (`scripts/licence-policy.mjs`) allows the five ids of decision 4, and their
  exceptions leave `config/licence-exceptions.json` (tslib, argparse, postgres,
  robust-predicates and the BlueOak dev tools). MIT-0, MPL-2.0, EPL-2.0 (elkjs) and CC-BY-4.0
  (caniuse-lite) still need a `cto`-approved entry.

## Alternatives considered
- Per-unit overhead criterion: rejected; it measures transaction cost, not isolation cost.
- One shared realm: rejected; each organisation's directory, login theme and password policy
  stay separate.
- Allow OFL-1.1 everywhere: rejected; it is a font licence and fits only fonts.
