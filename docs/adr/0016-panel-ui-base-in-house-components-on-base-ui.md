# ADR-0016: Panel UI Base — In-House Components on Base UI, Metronic as Visual Reference Only

**Status:** Accepted — 2026-10-27 (owner decisions: "visual only, Base UI base"; "nothing from
Metronic is used"; design brief approved)
**Relates to:** ADR-0001, ADR-0008, ADR-0009, ADR-0013, ADR-0020

## Context
The owner wants `apps/admin` and `apps/studio` to follow the look and page structure of the
Metronic 9.5 admin template closely. Metronic is sold under a commercial Envato licence (one
project per licence; SaaS that charges end users needs the Extended licence), which is outside
the ADR-0009 list. Its React kit is built on Radix (the ReUI set), while PoC 4 proved
`packages/ui` on Base UI with logical CSS, a Jalali date field and an axe-clean form. Metronic's
components also carry 246 physical left/right classes, set `dir` in the browser after load, load
Inter from Google, and pull in react-leaflet (Hippocratic-2.1, not allowed).

This ADR takes the panel-UI half of the reserved 0016 slot. The page builder (Puck in studio
only, PoC 4 R9) is decided at the Phase 3 review.

## Decision
1. **Nothing from Metronic enters the repository or the product.** That means no code, CSS,
   token files, icons, images, fonts, Figma files or text, and no copy-and-edit either. Metronic
   is a reference that people look at for layout, hierarchy, density and page behaviour only.
2. **Panels are built from in-house components** in `packages/ui` on **Base UI**, Tailwind on
   `--px-*` design tokens only, and logical CSS (ADR-0008). Tables use TanStack Table and trees
   use headless-tree (both MIT), each wrapped by our own components. Radix and ReUI are not
   added.
3. **Shell:** both panels use one shell pattern: side menu plus header, breadcrumb and toolbar,
   with a collapsible side menu. The menu is built from the user's permission keys. Studio adds
   a site switcher limited to the user's subtrees (ADR-0018).
4. **Direction and locale are set on the server.** `lang` and `dir` go on `<html>` from the
   tenant or site locale that the BFF resolves from the host; nothing switches direction
   client-side.
5. **Tokens:** panels use fixed product tokens, with light and dark sets (class strategy,
   default "system"), checked against WCAG 2.1 AA for both themes and the focus ring. A tenant
   changes only its logo and name in the panels; brand tokens apply to the portal.
6. **Icons and charts:** lucide-react (ISC) only; Recharts (MIT) only. *(Amended by ADR-0023: charts
   use Apache ECharts instead of Recharts.)* The Persian font stays
   open question P7 (Vazirmatn, OFL-1.1, self-hosted), and no font is loaded from a foreign host.
7. **Review:** every panel PR is checked to confirm that no file or fragment was copied from
   the Metronic distribution, along with the frontend quality checklist (375, 768 and 1280 px,
   light and dark, RTL, screenshots).

## Consequences
- There is no Metronic licence to buy or track, and ADR-0009 stays unchanged.
- More work than adopting the kit: every component is written by us. The PoC 4 code (theme,
  Persian text helpers, Jalali calendar, Field renderers) is the starting point.
- The screen-to-pattern map in the owner-approved Persian design brief (`docs/features/panel-ui-design-brief.md`) guides slice 1.10 (studio
  shell, users, roles, site and organisation trees) and the admin shell.

## Alternatives considered
- Adopt Metronic's ReUI components and layouts, moving panels to Radix: fastest and closest to
  the template, but it requires the Extended licence and a legal check for on-prem resale, and
  it means converting the RTL; rejected by the owner.
- Hybrid (Metronic shell and DataGrid, Base UI forms): two primitive libraries to maintain plus
  the licence issue; rejected.
