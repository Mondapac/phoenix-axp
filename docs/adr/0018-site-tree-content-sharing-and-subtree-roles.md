# ADR-0018: Site Tree, Content Sharing and Subtree Role Scope

**Status:** Accepted — 2026-10-26 (owner decision on the ministry scenario)
**Amends:** ADR-0002 (Site becomes a tree), ADR-0004 (site/organisation role scope gains a subtree option)
**Relates to:** ADR-0005, ADR-0010, ADR-0015

## Context
The first target customers are ministries. A ministry has a central site, sub-sites for each
deputy office, provincial head offices, and sub-sites under any of them, to any depth. Content
must flow down (a circular shown on every provincial site) and up (a provincial story promoted to
the central site), and an administrator of an upper site must manage the panels of every site
below it. ADR-0002 defined Site as a flat level under Tenant, and tenants share nothing by design.

## Decision
1. **One tenant per ministry.** A ministry, with all its deputy offices and provincial offices,
   is one Tenant. Tenants still share nothing (ADR-0002); sharing happens only inside a tenant.
2. **Site tree.** Every Site has an optional `parent_site_id` within the same tenant. A closure
   table `site_ancestry(tenant_id, ancestor_id, descendant_id, depth)` answers subtree queries.
   Both are tenant-scoped and under RLS. Depth has a configurable ceiling (default 8). A site
   may live on its own domain or on a path under its parent's domain.
3. **Site tree is separate from the Organization tree.** A Site may link to one Organization
   node; campaign sites need not. Reorganising the Organization chart does not move sites.
4. **Ownership separate from visibility.** Every content item, document, form and media item
   has one owner site (`owner_site_id`). A publication record states where else it appears:
   - this site only (default);
   - down to descendants, either mandatory (descendants cannot hide it) or optional (offered
     in a shared library);
   - up to the parent, **only after the parent approves it**, through a platform BPMN process
     (ADR-0005);
   - to an explicit list of sites in the same tenant.
   Shared content is referenced, not copied; a site that wants its own version takes a local
   copy that it owns.
5. **Inheritance defaults.** Theme tokens, global navigation and footer, and vocabularies flow
   from parent to child; a parent can lock parts (for example the ministry logo). Users and
   sign-in are tenant-wide. Forms and processes defined at a site are usable in its subtree.
6. **Subtree role scope.** A site-scoped role grant is either `thisSite` or `includeDescendants`.
   Access flows only downward, never up or sideways. An upper-site admin works in a lower-site
   panel under their own identity, and the audit log (ADR-0015) records it. GrantPolicy applies
   within the grantor's own subtree only. Moving a site recomputes access from the new tree and
   is audited.
7. **Cross-tenant sharing is deferred** (ADR-0010). If a provincial office legally needs its own
   database, it becomes a separate tenant, and sharing with the ministry would need an explicit
   cross-tenant bridge. Trigger: the first customer contract that requires it.

## Consequences
- The site tree and the subtree role scope are built in Phase 1 (core), because authorisation
  depends on them. Content publication is completed in Phase 4 (sites); the `owner_site_id`
  column exists from Phase 1.
- PoC 1 (slice 0.6) also tests one tenant with 500 sites in a tree and subtree access checks
  under RLS (owner decision, 2026-10-26).
- Search filters by the sites a content item is published to.

## Alternatives considered
- One tenant per province or deputy office: rejected; tenants share nothing, so up/down sharing
  would need the cross-tenant bridge from day one.
- Using the Organization tree as the site tree: rejected; organisation charts change more often
  than sites and campaign sites have no organisation node.
- Copying shared content into each site: rejected; corrections would not propagate.
