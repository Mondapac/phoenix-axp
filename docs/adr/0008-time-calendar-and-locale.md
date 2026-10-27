# ADR-0008: Time, Calendars, Locale and RTL

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision)
**Relates to:** MondaPac ADR-0005 (time zones), MondaPac ADR-0033 (panel UI), ADR-0002

## Context
Tenants operate inside and outside Iran, in Persian and other languages, on the Jalali and
Gregorian calendars and in several time zones. Deadlines, timers and SLAs must be correct in the
owning party's zone and calendar. MondaPac learned to forbid raw dates in domain code.

## Decision
1. **Instants in UTC** (`timestamptz`), zones as IANA ids. Domain code uses Temporal through the
   injected `Clock`; `new Date()` and `Date.now()` are forbidden by lint.
2. **Owning party's zone and calendar:** a tenant's zone, calendar and locale are defaults only;
   a site, organisation or user may override them. Deadlines, SLAs, reports and notifications
   are evaluated in the owning party's zone and working calendar (V2 effective-dated, ADR-0007).
3. **Calendars:** Jalali and Gregorian supported from day one for display, input and working
   calendars; storage is always an instant or an ISO date.
4. **Locale:** next-intl in panels; Persian digits and formats by locale; no hardcoded language.
   Languages beyond Persian and English are decided in the Phase 1 review.
5. **RTL from day one:** logical CSS only (lint forbids physical left/right utilities), no raw
   colours, no `dangerouslySetInnerHTML`; bidi-safe mixed text.
6. **Persian text normalisation** (ی/ي, ک/ك, ZWNJ, digits) at input and in search.
7. **Tests** use two tenant fixtures with different zone, calendar and locale.

## Consequences
- Every date field in a design states its zone and calendar.
- PoC 4 (slice 0.9) proves a Persian portal page and a Jalali form at WCAG 2.1 AA.

## Alternatives considered
- Server-local time or a single tenant zone: wrong for multi-site government tenants.
- Storing Jalali dates: complicates arithmetic and interchange.
