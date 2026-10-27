-- PoC 1 (slice 0.6) seed: 1000 tenants with realistic data, plus one "ministry" tenant with a
-- 500-site tree (ADR-0018). Runs as the migration role (table owner, not subject to RLS).
-- Ids are deterministic (md5 of a name, cast to uuid) so tests can name rows; the product uses
-- UUIDv7 from the IdGenerator.
\set ON_ERROR_STOP on
SELECT setseed(0.42);
SET synchronous_commit = off;

-- 1000 tenants t0001..t1000.
CREATE TEMP TABLE tenants AS
  SELECT n, 't' || lpad(n::text, 4, '0') AS tenant_id, 2 + (n % 8) AS child_sites
    FROM generate_series(1, 1000) AS n;

-- Sites: one root and 2..9 children per tenant.
INSERT INTO site.site (id, tenant_id, parent_site_id, slug, name, depth, created_at)
SELECT md5(t.tenant_id || '/site/0')::uuid, t.tenant_id, NULL, 'root', 'Main site', 0,
       timestamptz '2026-01-01'
  FROM tenants t;
INSERT INTO site.site (id, tenant_id, parent_site_id, slug, name, depth, created_at)
SELECT md5(t.tenant_id || '/site/' || c)::uuid, t.tenant_id, md5(t.tenant_id || '/site/0')::uuid,
       'sub-' || c, 'Sub-site ' || c, 1, timestamptz '2026-01-02'
  FROM tenants t, generate_series(1, 9) AS c
 WHERE c <= t.child_sites;

-- Content: 200 items per tenant, spread over its sites; ~500 characters of body each.
INSERT INTO content.content_item
  (id, tenant_id, owner_site_id, title, body, status, version, created_at, updated_at)
SELECT md5(t.tenant_id || '/item/' || i)::uuid, t.tenant_id,
       md5(t.tenant_id || '/site/' || (i % (t.child_sites + 1)))::uuid,
       'News ' || i || ' of ' || t.tenant_id,
       repeat(md5(t.tenant_id || i::text), 16),
       CASE WHEN i % 10 < 7 THEN 'published' WHEN i % 10 < 9 THEN 'draft' ELSE 'archived' END,
       1,
       timestamptz '2026-01-01' + make_interval(mins => i * 37),
       timestamptz '2026-01-01' + make_interval(mins => i * 37)
  FROM tenants t, generate_series(1, 200) AS i;

-- Form submissions: 300 per tenant.
INSERT INTO forms.form_submission (id, tenant_id, site_id, form_key, payload, submitted_at)
SELECT md5(t.tenant_id || '/sub/' || i)::uuid, t.tenant_id,
       md5(t.tenant_id || '/site/' || (i % (t.child_sites + 1)))::uuid,
       'contact-' || (i % 5),
       jsonb_build_object('name', 'Person ' || i, 'message', 'Message ' || i, 'consent', true),
       timestamptz '2026-02-01' + make_interval(mins => i * 11)
  FROM tenants t, generate_series(1, 300) AS i;

-- Roles and grants: 3 roles, 20 grants per tenant.
INSERT INTO identity.role (id, tenant_id, key, permissions)
SELECT md5(t.tenant_id || '/role/' || r.key)::uuid, t.tenant_id, r.key, r.permissions
  FROM tenants t,
       (VALUES ('viewer', ARRAY['content.item.read']::varchar[]),
               ('editor', ARRAY['content.item.read', 'content.item.write']::varchar[]),
               ('site-admin', ARRAY['content.item.read', 'content.item.write', 'site.panel.manage']::varchar[]))
         AS r (key, permissions);
INSERT INTO identity.role_grant (id, tenant_id, principal_id, role_id, site_id, include_descendants, created_at)
SELECT md5(t.tenant_id || '/grant/' || g)::uuid, t.tenant_id,
       md5(t.tenant_id || '/principal/' || (g % 10))::uuid,
       md5(t.tenant_id || '/role/' || (ARRAY['viewer', 'editor', 'site-admin'])[1 + g % 3])::uuid,
       CASE WHEN g % 4 = 0 THEN NULL ELSE md5(t.tenant_id || '/site/' || (g % (t.child_sites + 1)))::uuid END,
       g % 2 = 0, timestamptz '2026-01-03'
  FROM tenants t, generate_series(1, 20) AS g;

-- The ministry: 500 sites in a tree, depth up to 8 (ADR-0018 decision 2).
--   1 root; 10 deputy offices and 31 provincial offices under it; 8 counties per province;
--   5 sub-sites per deputy office; 1 sub-site under each of the first 100 counties; and
--   12 chains of 5 levels under county sub-sites, down to depth 8.
CREATE TEMP TABLE ministry_tree (n int PRIMARY KEY, parent int, depth int, slug text);
INSERT INTO ministry_tree VALUES (0, NULL, 0, 'ministry');
INSERT INTO ministry_tree SELECT d, 0, 1, 'deputy-' || d FROM generate_series(1, 10) d;
INSERT INTO ministry_tree SELECT 10 + p, 0, 1, 'province-' || p FROM generate_series(1, 31) p;
INSERT INTO ministry_tree
  SELECT 41 + (p - 1) * 8 + c, 10 + p, 2, 'province-' || p || '-county-' || c
    FROM generate_series(1, 31) p, generate_series(1, 8) c;                       -- 42..289
INSERT INTO ministry_tree
  SELECT 289 + (d - 1) * 5 + s, d, 2, 'deputy-' || d || '-unit-' || s
    FROM generate_series(1, 10) d, generate_series(1, 5) s;                        -- 290..339
INSERT INTO ministry_tree
  SELECT 339 + k, 41 + k, 3, 'county-' || k || '-office' FROM generate_series(1, 100) k; -- 340..439
INSERT INTO ministry_tree
  SELECT 439 + (ch - 1) * 5 + lvl,
         CASE WHEN lvl = 1 THEN 339 + ch ELSE 439 + (ch - 1) * 5 + lvl - 1 END,
         3 + lvl, 'chain-' || ch || '-level-' || lvl
    FROM generate_series(1, 12) ch, generate_series(1, 5) lvl;                     -- 440..499

INSERT INTO site.site (id, tenant_id, parent_site_id, slug, name, depth, created_at)
SELECT md5('ministry/site/' || m.n)::uuid, 'ministry',
       CASE WHEN m.parent IS NULL THEN NULL ELSE md5('ministry/site/' || m.parent)::uuid END,
       m.slug, initcap(replace(m.slug, '-', ' ')), m.depth, timestamptz '2026-01-01'
  FROM ministry_tree m ORDER BY m.depth, m.n;

-- Content: 120 items per ministry site (60 000).
INSERT INTO content.content_item
  (id, tenant_id, owner_site_id, title, body, status, version, created_at, updated_at)
SELECT md5('ministry/item/' || m.n || '/' || i)::uuid, 'ministry', md5('ministry/site/' || m.n)::uuid,
       'Circular ' || i || ' of ' || m.slug, repeat(md5(m.n::text || i::text), 16),
       CASE WHEN i % 10 < 7 THEN 'published' ELSE 'draft' END, 1,
       timestamptz '2026-01-01' + make_interval(mins => (i * 500 + m.n) * 3),
       timestamptz '2026-01-01' + make_interval(mins => (i * 500 + m.n) * 3)
  FROM ministry_tree m, generate_series(1, 120) AS i;

INSERT INTO identity.role (id, tenant_id, key, permissions)
VALUES (md5('ministry/role/editor')::uuid, 'ministry', 'editor',
        ARRAY['content.item.read', 'content.item.write']::varchar[]),
       (md5('ministry/role/site-admin')::uuid, 'ministry', 'site-admin',
        ARRAY['content.item.read', 'content.item.write', 'site.panel.manage']::varchar[]);

-- 200 principals with 1..5 grants each at random sites; half include descendants.
INSERT INTO identity.role_grant (id, tenant_id, principal_id, role_id, site_id, include_descendants, created_at)
SELECT md5('ministry/grant/' || p || '/' || g)::uuid, 'ministry', md5('ministry/principal/' || p)::uuid,
       md5('ministry/role/' || CASE WHEN g % 2 = 0 THEN 'editor' ELSE 'site-admin' END)::uuid,
       md5('ministry/site/' || ((p * 37 + g * 101) % 500))::uuid, (p + g) % 2 = 0, timestamptz '2026-01-03'
  FROM generate_series(1, 200) p, generate_series(1, 5) g
 WHERE g <= 1 + p % 5;

-- The closure table of every tenant's tree, from the parent pointers.
INSERT INTO site.site_ancestry (tenant_id, ancestor_id, descendant_id, depth)
WITH RECURSIVE up AS (
  SELECT s.tenant_id, s.id AS descendant_id, s.id AS ancestor_id, s.parent_site_id AS next_id, 0 AS depth
    FROM site.site s
  UNION ALL
  SELECT up.tenant_id, up.descendant_id, p.id, p.parent_site_id, up.depth + 1
    FROM up JOIN site.site p ON p.tenant_id = up.tenant_id AND p.id = up.next_id
)
SELECT tenant_id, ancestor_id, descendant_id, depth FROM up;

ANALYZE;
