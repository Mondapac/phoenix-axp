import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardToolbar,
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
import { notFound } from 'next/navigation';
import {
  ancestorsOf,
  childrenOf,
  domainAddress,
  isId,
  moveTargets,
  organizationNode,
  siteNode,
  treeOrder,
  type OrganizationNode,
  type SiteNode,
  type SiteView,
} from '../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { MoveDialog } from '../../_parts/move-dialog';
import {
  AddDomainDialog,
  CreateSiteDialog,
  EditSiteDialog,
  RemoveDomainButton,
} from '../sites-client';

// One site (GET tenancy/sites/:id): its place in the tree, its subsites and its domains. Every
// change needs `tenancy.sites.manage`; the API checks it again.

interface Props {
  readonly params: Promise<{ readonly siteId: string }>;
}

const DOMAIN_COLUMNS = ['50%', '35%', '15%'];

export default async function SitePage({ params }: Props) {
  const { siteId } = await params;
  const { t, tenant, held, csrfToken } = await studioSession();
  if (!isId(siteId)) notFound();
  const site = await readForPage<SiteView>(`tenancy/sites/${siteId}`);
  const crumbsBase = [
    { label: t['menu.structure'], href: '/structure' },
    { label: t['sites.title'], href: '/structure/sites' },
  ];
  if (site === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['sites.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const locale = tenant.defaultLocale;
  const [listed, units] = await Promise.all([
    readForPage<{ items: SiteNode[] }>('tenancy/sites'),
    held.has('tenancy.organizations.view')
      ? readForPage<{ items: OrganizationNode[] }>('tenancy/organizations')
      : null,
  ]);
  const sites = treeOrder(listed?.items ?? [], siteNode, locale);
  const organizations = units === null ? null : treeOrder(units.items, organizationNode, locale);
  const parents = ancestorsOf(sites, siteNode, site.id);
  const parent = parents.at(-1);
  const children = childrenOf(sites, siteNode, site.id);
  const unit = organizations?.find((u) => u.id === site.organizationId);
  const manage = held.has('tenancy.sites.manage');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[
              ...crumbsBase,
              ...parents.map((p) => ({ label: p.name, href: `/structure/sites/${p.id}` })),
              { label: site.name },
            ]}
          />
        }
        title={site.name}
        actions={
          manage ? (
            <div className="flex flex-wrap gap-2">
              <EditSiteDialog
                t={t}
                csrfToken={csrfToken}
                site={site}
                organizations={organizations}
              />
              <MoveDialog
                t={t}
                csrfToken={csrfToken}
                name={site.name}
                description={t['site.move.description']}
                rootLabel={t['siteForm.root']}
                currentParentId={site.parentSiteId}
                targets={moveTargets(sites, siteNode, site.id)}
                route={`tenancy/sites/${site.id}/move`}
                parentField="newParentSiteId"
              />
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t['site.details']}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['sites.col.slug']}</dt>
              <dd className="truncate text-fg">
                <Ltr>{site.slug}</Ltr>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['siteForm.parent']}</dt>
              <dd className="truncate text-fg">
                {parent === undefined ? (
                  t['tree.root']
                ) : (
                  <Link href={`/structure/sites/${parent.id}`} className="hover:text-accent">
                    {parent.name}
                  </Link>
                )}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['tree.level']}</dt>
              <dd className="text-fg">{formatNumber(site.depth + 1, locale)}</dd>
            </div>
            {organizations === null ? null : (
              <div className="min-w-0 space-y-1">
                <dt className="text-fg-muted">{t['sites.col.organization']}</dt>
                <dd className="truncate text-fg">
                  {unit === undefined ? (
                    t['siteForm.noOrganization']
                  ) : (
                    <Link
                      href={`/structure/organizations/${unit.id}`}
                      className="hover:text-accent"
                    >
                      {unit.name}
                    </Link>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0 space-y-1">
            <CardTitle>{t['domains.title']}</CardTitle>
            <CardDescription>{t['domains.description']}</CardDescription>
          </div>
          {manage ? (
            <CardToolbar>
              <AddDomainDialog t={t} csrfToken={csrfToken} siteId={site.id} />
            </CardToolbar>
          ) : null}
        </CardHeader>
        {site.domains.length === 0 ? (
          <EmptyState icon={<Globe aria-hidden />} title={t['domains.empty']} />
        ) : (
          <>
            <ul className="sm:hidden">
              {site.domains.map((domain) => (
                <li
                  key={domain.id}
                  className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 truncate text-fg">
                    <Ltr>{domainAddress(domain)}</Ltr>
                  </div>
                  {manage ? (
                    <RemoveDomainButton
                      t={t}
                      csrfToken={csrfToken}
                      domainId={domain.id}
                      address={domainAddress(domain)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={DOMAIN_COLUMNS} className="min-w-[32rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['domains.col.host']}</TableHead>
                    <TableHead>{t['domains.col.path']}</TableHead>
                    <TableHead className="relative text-end">
                      <span className="sr-only">{t['common.actions']}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {site.domains.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell className="truncate">
                        <Ltr>{domain.hostname}</Ltr>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        {domain.pathPrefix === '' ? (
                          t['domains.wholeHost']
                        ) : (
                          <Ltr>{domain.pathPrefix}</Ltr>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        {manage ? (
                          <RemoveDomainButton
                            t={t}
                            csrfToken={csrfToken}
                            domainId={domain.id}
                            address={domainAddress(domain)}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t['site.children']}</CardTitle>
          {manage ? (
            <CardToolbar>
              <CreateSiteDialog
                t={t}
                csrfToken={csrfToken}
                sites={sites}
                organizations={organizations}
                parentId={site.id}
                trigger="outline"
              />
            </CardToolbar>
          ) : null}
        </CardHeader>
        {children.length === 0 ? (
          <EmptyState icon={<Globe aria-hidden />} title={t['site.children.empty']} />
        ) : (
          <ul>
            {children.map((child) => (
              <li
                key={child.id}
                className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0"
              >
                <Link
                  href={`/structure/sites/${child.id}`}
                  className="truncate font-medium text-fg hover:text-accent"
                >
                  {child.name}
                </Link>
                <span className="shrink-0 truncate text-sm text-fg-muted">
                  <Ltr>{child.slug}</Ltr>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
