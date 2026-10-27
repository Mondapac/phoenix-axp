-- PoC 2 seed: the two tenant fixtures (ADR-0002 rule 8), a small site tree, content and roles.
-- Staff accounts and grants are created by the test, once Keycloak has given the users' ids.
--   demo-fa:  root -> province-1 -> county-1 ; root -> province-2
--   demo-en:  root -> branch
INSERT INTO site.site (id, tenant_id, parent_site_id, slug, name, depth, created_at) VALUES
  (md5('demo-fa/site/root')::uuid,      'demo-fa', NULL,                                 'root',       'وزارت',        0, '2026-10-01'),
  (md5('demo-fa/site/province-1')::uuid,'demo-fa', md5('demo-fa/site/root')::uuid,       'province-1', 'استان ۱',      1, '2026-10-01'),
  (md5('demo-fa/site/county-1')::uuid,  'demo-fa', md5('demo-fa/site/province-1')::uuid, 'county-1',   'شهرستان ۱',    2, '2026-10-01'),
  (md5('demo-fa/site/province-2')::uuid,'demo-fa', md5('demo-fa/site/root')::uuid,       'province-2', 'استان ۲',      1, '2026-10-01'),
  (md5('demo-en/site/root')::uuid,      'demo-en', NULL,                                 'root',       'Agency',       0, '2026-10-01'),
  (md5('demo-en/site/branch')::uuid,    'demo-en', md5('demo-en/site/root')::uuid,       'branch',     'Branch',       1, '2026-10-01');

INSERT INTO site.site_ancestry (tenant_id, ancestor_id, descendant_id, depth)
WITH RECURSIVE up AS (
  SELECT tenant_id, id AS descendant_id, id AS ancestor_id, parent_site_id AS next_id, 0 AS depth FROM site.site
  UNION ALL
  SELECT up.tenant_id, up.descendant_id, p.id, p.parent_site_id, up.depth + 1
    FROM up JOIN site.site p ON p.tenant_id = up.tenant_id AND p.id = up.next_id)
SELECT tenant_id, ancestor_id, descendant_id, depth FROM up;

INSERT INTO content.content_item (id, tenant_id, owner_site_id, title, body, status, version, created_at, updated_at)
SELECT md5(s.tenant_id || s.slug || i)::uuid, s.tenant_id, s.id, s.name || ' — ' || i, 'body', 'published', 1,
       timestamptz '2026-10-01' + make_interval(hours => i), timestamptz '2026-10-01' + make_interval(hours => i)
  FROM site.site s, generate_series(1, 5) i;

INSERT INTO identity.role (id, tenant_id, key, permissions) VALUES
  (md5('demo-fa/role/editor')::uuid,      'demo-fa', 'editor',      ARRAY['content.item.read']),
  (md5('demo-fa/role/staff-admin')::uuid, 'demo-fa', 'staff-admin', ARRAY['content.item.read', 'identity.role-grant.revoke', 'identity.staff-account.disable']),
  (md5('demo-en/role/editor')::uuid,      'demo-en', 'editor',      ARRAY['content.item.read']);
