import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardToolbar,
  EmptyState,
  formatNumber,
  Ltr,
  PageContainer,
  PageHeader,
} from '@phoenix/ui';
import { Globe, Network } from 'lucide-react';
import { notFound } from 'next/navigation';
import {
  ancestorsOf,
  childrenOf,
  moveTargets,
  organizationNode,
  siteNode,
  treeOrder,
  type OrganizationNode,
  type SiteNode,
} from '../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { MoveDialog } from '../../_parts/move-dialog';
import { CreateUnitDialog, RenameUnitDialog } from '../organizations-client';

// One organization unit: its place in the chart, the units below it and the sites that belong
// to it. The API has no read of one unit; the chart is small and read whole. Every change
// needs `tenancy.organizations.manage`; the API checks it again.

interface Props {
  readonly params: Promise<{ readonly organizationId: string }>;
}

export default async function OrganizationPage({ params }: Props) {
  const { organizationId } = await params;
  const { t, tenant, held, csrfToken } = await studioSession();
  const listed = await readForPage<{ items: OrganizationNode[] }>('tenancy/organizations');
  const crumbsBase = [
    { label: t['menu.structure'], href: '/structure' },
    { label: t['orgs.title'], href: '/structure/organizations' },
  ];
  if (listed === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['orgs.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }
  const locale = tenant.defaultLocale;
  const units = treeOrder(listed.items, organizationNode, locale);
  const unit = units.find((u) => u.id === organizationId);
  if (unit === undefined) notFound();

  const siteList = held.has('tenancy.sites.view')
    ? await readForPage<{ items: SiteNode[] }>('tenancy/sites')
    : null;
  const sites =
    siteList === null
      ? null
      : treeOrder(siteList.items, siteNode, locale).filter((s) => s.organizationId === unit.id);
  const parents = ancestorsOf(units, organizationNode, unit.id);
  const parent = parents.at(-1);
  const children = childrenOf(units, organizationNode, unit.id);
  const manage = held.has('tenancy.organizations.manage');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[
              ...crumbsBase,
              ...parents.map((p) => ({ label: p.name, href: `/structure/organizations/${p.id}` })),
              { label: unit.name },
            ]}
          />
        }
        title={unit.name}
        actions={
          manage ? (
            <div className="flex flex-wrap gap-2">
              <RenameUnitDialog t={t} csrfToken={csrfToken} unit={unit} />
              <MoveDialog
                t={t}
                csrfToken={csrfToken}
                name={unit.name}
                description={t['org.move.description']}
                rootLabel={t['orgForm.root']}
                currentParentId={unit.parentId}
                targets={moveTargets(units, organizationNode, unit.id)}
                route={`tenancy/organizations/${unit.id}/move`}
                parentField="newParentId"
              />
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t['org.details']}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['orgForm.parent']}</dt>
              <dd className="truncate text-fg">
                {parent === undefined ? (
                  t['org.top']
                ) : (
                  <Link
                    href={`/structure/organizations/${parent.id}`}
                    className="hover:text-accent"
                  >
                    {parent.name}
                  </Link>
                )}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['tree.level']}</dt>
              <dd className="text-fg">{formatNumber(unit.depth + 1, locale)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t['org.children']}</CardTitle>
          {manage ? (
            <CardToolbar>
              <CreateUnitDialog
                t={t}
                csrfToken={csrfToken}
                units={units}
                parentId={unit.id}
                trigger="outline"
              />
            </CardToolbar>
          ) : null}
        </CardHeader>
        {children.length === 0 ? (
          <EmptyState icon={<Network aria-hidden />} title={t['org.children.empty']} />
        ) : (
          <ul>
            {children.map((child) => (
              <li key={child.id} className="border-b border-line px-5 py-3 last:border-b-0">
                <Link
                  href={`/structure/organizations/${child.id}`}
                  className="block truncate font-medium text-fg hover:text-accent"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sites === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{t['org.sites']}</CardTitle>
          </CardHeader>
          {sites.length === 0 ? (
            <EmptyState icon={<Globe aria-hidden />} title={t['org.sites.empty']} />
          ) : (
            <ul>
              {sites.map((site) => (
                <li
                  key={site.id}
                  className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0"
                >
                  <Link
                    href={`/structure/sites/${site.id}`}
                    className="truncate font-medium text-fg hover:text-accent"
                  >
                    {site.name}
                  </Link>
                  <span className="shrink-0 truncate text-sm text-fg-muted">
                    <Ltr>{site.slug}</Ltr>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </PageContainer>
  );
}
