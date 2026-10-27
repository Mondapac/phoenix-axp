# ADR-0023: Panel Shell, Panel Colours and Chart Library

**Status:** Accepted — 2026-10-27 (owner decisions on three decision cards)
**Amends:** ADR-0016 decision 6
**Relates to:** ADR-0009, ADR-0016, ADR-0022

## Context
ADR-0016 set the panel UI base and recorded three team defaults: the shell layout, fixed panel
colours, and Recharts for charts. The owner answered each as a decision card on 2026-10-27, and
for charts chose ECharts over the team's pick.

## Decision
1. **Shell:** `apps/admin` and `apps/studio` share one shell: a collapsible side menu plus a
   header with breadcrumb and toolbar. The menu comes from the user's permission keys, and
   studio adds the site switcher (ADR-0016 decision 3, confirmed).
2. **Panel colours:** panels use fixed product tokens in light and dark. A tenant changes only
   its logo and name in the panels; tenant brand tokens apply to the portal only (ADR-0016
   decision 5, confirmed).
3. **Charts:** **Apache ECharts** (Apache-2.0, with zrender, BSD-3-Clause) is the only chart
   library for panels and portal dashboards, replacing Recharts in ADR-0016 decision 6. Icons
   stay lucide-react only.
   - Import only the needed chart, component and renderer modules through `echarts/core`, so
     the bundle stays small.
   - It is wrapped once in `packages/ui` (`<Chart>`), which applies product tokens, light and
     dark themes, the Vazirmatn font (ADR-0022), Persian digits through formatters, and RTL:
     inverted category axes and the legend on the reading-start side.
   - It loads no remote resources (maps or themes from a CDN are not used), so offline installs
     work.
   - Each chart has a text alternative: an accessible summary plus an optional data table.
4. Adding ECharts is its own dependency PR with the licences stated (CLAUDE.md rule 12), landed
   with the first chart.

## Consequences
- ECharts gives richer charts (large data sets, heatmaps, Sankey and gauges) than Recharts, but
  its bundle is larger; modular import keeps it out of pages without charts.
- ECharts renders to canvas by default; the SVG renderer is used where crisp print or screen
  readers matter, and the accessible summary is required either way.

## Alternatives considered
- Recharts (MIT, ADR-0016's original pick): lighter and React-native, not chosen by the owner.
- Top menu or two-column menu shells: offered on the card; not chosen.
- Tenant-chosen panel primary colour: offered on the card; not chosen.
