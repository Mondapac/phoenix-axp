# ADR-0022: Phase 1 Follow-up Decisions — Isolation Overhead, AD Sync Interval, Font Licence

**Status:** Accepted — 2026-10-27 (owner decisions on cards P5, P6 and P7 of the Phase 1 review)
**Amends:** ADR-0002 (isolation overhead criterion), ADR-0009 (licence allow-list, fonts only)
**Relates to:** ADR-0004, ADR-0020, `docs/reviews/poc-1-tenant-isolation.md`,
`docs/reviews/poc-2-hybrid-login.md`, `docs/reviews/poc-4-rtl-portal.md`

## Context
The Phase 0 PoCs left three questions open (Phase 1 review, cards P5 to P7):
- PoC 1 showed that RLS policies cost within noise, but a transaction per tiny unit of work costs
  more than 15% on sub-millisecond reads. The criterion in ADR-0002 did not say what it measures.
- PoC 2 showed that Keycloak sends no back-channel when an account is disabled in AD; the core
  learns it only from a periodic sync, so the sync interval is the revocation delay.
- PoC 4 picked Vazirmatn as the Persian font. Its licence, SIL OFL-1.1, is not on the ADR-0009
  allow-list.

## Decision
1. **Isolation overhead (P5).** The criterion "overhead under 15%" is measured per request, end
   to end (tenant guard plus RLS against guard alone), not per unit of work. RLS stays. The
   adapter sets the tenant in one statement right after `BEGIN`, and a request reads what it
   needs in as few units as practical (ADR-0020).
2. **AD disable delay (P6).** Staff account sync with the identity provider runs per tenant on a
   configurable interval, **default 5 minutes**. Studio offers "sync now", and where a customer
   can send AD change events, an event triggers the sync at once. The interval is a tenant
   setting with a lower and upper bound fixed in the identity slice (1.5).
3. **Font licence (P7).** SIL OFL-1.1 is allowed **for font files only** (for example Vazirmatn),
   unmodified, and self-hosted from our own servers; no external font CDN. Code under OFL-1.1, or
   any other use, still needs a reviewed exception under ADR-0009.

## Consequences
- PoC 1's per-request result meets the criterion; the per-unit numbers stay in the report as
  context, not as a failure.
- Slice 1.5 builds the sync job, the tenant setting and "sync now". The longest delay between an
  AD disable and the next refused request is the tenant's interval (5 minutes by default).
- Slice 1.9 may ship Vazirmatn. The licence gate gets a font-only rule for OFL-1.1 when the first
  font package lands (until then no OFL package is in the tree).

## Alternatives considered
- Per-unit criterion: rejected; it measures transaction cost, not isolation cost.
- Fixed 1-minute sync for every tenant: rejected; load on large ADs, and some customers accept
  more.
- Allow OFL-1.1 everywhere: rejected; it is a font licence and fits only fonts.
