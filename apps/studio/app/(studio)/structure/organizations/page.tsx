import {
  Card,
  EmptyState,
  formatNumber,
  PageContainer,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@phoenix/ui';
import { Network } from 'lucide-react';
import {
  childrenOf,
  organizationNode,
  treeOrder,
  type OrganizationNode,
  type SiteNode,
} from '../../../_lib/structure';
import { fill } from '../../../_i18n/messages';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { TreeName } from '../_parts/tree-name';
import { CreateUnitDialog } from './organizations-client';

// The tenant's organization chart (GET tenancy/organizations, ADR-0018 decision 3): every unit
// under its parent. Creating a unit needs `tenancy.organizations.manage`; the sites column needs
// `tenancy.sites.view`.

const COLUMNS_WITH_SITES = ['60%', '20%', '20%'];
const COLUMNS = ['75%', '25%'];

export default async function OrganizationsPage() {
  const { t, tenant, held, csrfToken } = await studioSession();
  const listed = await readForPage<{ items: OrganizationNode[] }>('tenancy/organizations');
  const siteList = held.has('tenancy.sites.view')
    ? await readForPage<{ items: SiteNode[] }>('tenancy/sites')
    : null;
  const locale = tenant.defaultLocale;
  const units = listed === null ? [] : treeOrder(listed.items, organizationNode, locale);
  const sites = siteList?.items ?? null;
  const below = (id: string) =>
    formatNumber(childrenOf(units, organizationNode, id).length, locale);
  const siteCount = (id: string) =>
    formatNumber(sites?.filter((site) => site.organizationId === id).length ?? 0, locale);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[{ label: t['menu.structure'], href: '/structure' }, { label: t['orgs.title'] }]}
          />
        }
        title={t['orgs.title']}
        description={t['orgs.description']}
        actions={
          listed !== null && held.has('tenancy.organizations.manage') ? (
            <CreateUnitDialog t={t} csrfToken={csrfToken} units={units} />
          ) : null
        }
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : units.length === 0 ? (
          <EmptyState
            icon={<Network aria-hidden />}
            title={t['orgs.empty.title']}
            description={t['orgs.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {units.map((unit) => (
                <li
                  key={unit.id}
                  className="space-y-1 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <TreeName
                    depth={unit.depth}
                    name={unit.name}
                    href={`/structure/organizations/${unit.id}`}
                  />
                  <p className="text-sm text-fg-muted">
                    {fill(t['orgs.counts'], { units: below(unit.id) })}
                    {sites === null
                      ? null
                      : ` · ${fill(t['orgs.siteCount'], { sites: siteCount(unit.id) })}`}
                  </p>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table
                columns={sites === null ? COLUMNS : COLUMNS_WITH_SITES}
                className="min-w-[32rem]"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['orgs.col.name']}</TableHead>
                    <TableHead numeric>{t['orgs.col.units']}</TableHead>
                    {sites === null ? null : <TableHead numeric>{t['orgs.col.sites']}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <TreeName
                          depth={unit.depth}
                          name={unit.name}
                          href={`/structure/organizations/${unit.id}`}
                        />
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {below(unit.id)}
                      </TableCell>
                      {sites === null ? null : (
                        <TableCell numeric className="text-fg-muted">
                          {siteCount(unit.id)}
                        </TableCell>
                      )}
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
