import {
  Card,
  EmptyState,
  formatNumber,
  Ltr,
  PageContainer,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@phoenix/ui';
import { Globe } from 'lucide-react';
import {
  childrenOf,
  organizationNode,
  siteNode,
  treeOrder,
  type OrganizationNode,
  type SiteNode,
} from '../../../_lib/structure';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { TreeName } from '../_parts/tree-name';
import { CreateSiteDialog } from './sites-client';

// The tenant's site tree (GET tenancy/sites, ADR-0018): every site under its parent. Creating a
// site needs `tenancy.sites.manage`; the organization unit column needs
// `tenancy.organizations.view`.

const COLUMNS_WITH_UNIT = ['40%', '22%', '24%', '14%'];
const COLUMNS = ['56%', '30%', '14%'];

export default async function SitesPage() {
  const { t, tenant, held, csrfToken } = await studioSession();
  const listed = await readForPage<{ items: SiteNode[] }>('tenancy/sites');
  const units = held.has('tenancy.organizations.view')
    ? await readForPage<{ items: OrganizationNode[] }>('tenancy/organizations')
    : null;
  const locale = tenant.defaultLocale;
  const sites = listed === null ? [] : treeOrder(listed.items, siteNode, locale);
  const organizations = units === null ? null : treeOrder(units.items, organizationNode, locale);
  const unitName = (id: string | null) =>
    id === null ? '' : (organizations?.find((unit) => unit.id === id)?.name ?? '');
  const count = (id: string) => formatNumber(childrenOf(sites, siteNode, id).length, locale);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[
              { label: t['menu.structure'], href: '/structure' },
              { label: t['sites.title'] },
            ]}
          />
        }
        title={t['sites.title']}
        description={t['sites.description']}
        actions={
          listed !== null && held.has('tenancy.sites.manage') ? (
            <CreateSiteDialog
              t={t}
              csrfToken={csrfToken}
              sites={sites}
              organizations={organizations}
            />
          ) : null
        }
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : sites.length === 0 ? (
          <EmptyState
            icon={<Globe aria-hidden />}
            title={t['sites.empty.title']}
            description={t['sites.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {sites.map((site) => (
                <li
                  key={site.id}
                  className="space-y-1 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <TreeName
                    depth={site.depth}
                    name={site.name}
                    href={`/structure/sites/${site.id}`}
                  />
                  <p className="flex min-w-0 flex-wrap gap-x-2 text-sm text-fg-muted">
                    <Ltr className="truncate">{site.slug}</Ltr>
                    {unitName(site.organizationId) === '' ? null : (
                      <span className="truncate">· {unitName(site.organizationId)}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table
                columns={organizations === null ? COLUMNS : COLUMNS_WITH_UNIT}
                className="min-w-[36rem]"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['sites.col.name']}</TableHead>
                    <TableHead>{t['sites.col.slug']}</TableHead>
                    {organizations === null ? null : (
                      <TableHead>{t['sites.col.organization']}</TableHead>
                    )}
                    <TableHead numeric>{t['sites.col.children']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell>
                        <TreeName
                          depth={site.depth}
                          name={site.name}
                          href={`/structure/sites/${site.id}`}
                        />
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <Ltr>{site.slug}</Ltr>
                      </TableCell>
                      {organizations === null ? null : (
                        <TableCell className="truncate text-fg-muted">
                          {unitName(site.organizationId)}
                        </TableCell>
                      )}
                      <TableCell numeric className="text-fg-muted">
                        {count(site.id)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </PageContainer>
  );
}
