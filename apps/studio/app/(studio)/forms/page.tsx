import Link from 'next/link';
import {
  Badge,
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
import { ClipboardList } from 'lucide-react';
import { cookies } from 'next/headers';
import { STATUS_TONE, type FormRecord } from '../../_lib/forms';
import { roleName, type Role } from '../../_lib/people';
import { readForPage, studioSession } from '../../_server/session';
import { SITE_COOKIE } from '../_shell/site-cookie';
import { NoAccess, PageCrumbs } from '../_components/page-parts';
import { CreateFormDialog } from './forms-client';

// The forms of the sites the member reaches (GET forms/forms, slice 2.4, `forms.forms.view`).
// Creating a form needs `forms.forms.design`.

const COLUMNS = ['34%', '22%', '20%', '14%', '10%'];

export default async function FormsPage() {
  const { t, tenant, held, sites, csrfToken } = await studioSession();
  const [listed, roles] = await Promise.all([
    held.has('forms.forms.view') ? readForPage<{ items: FormRecord[] }>('forms/forms') : null,
    held.has('identity.roles.view') && held.has('forms.forms.design')
      ? readForPage<{ items: Role[] }>('identity/roles')
      : null,
  ]);
  const locale = tenant.defaultLocale;
  const collator = new Intl.Collator(locale);
  const forms = [...(listed?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name));
  const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? '';
  const currentSite = (await cookies()).get(SITE_COOKIE)?.value ?? null;
  const roleOptions =
    roles === null
      ? null
      : roles.items.map((role) => ({ id: role.id, label: roleName(t, role.key) }));

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[{ label: t['forms.title'] }]} />}
        title={t['forms.title']}
        description={t['forms.description']}
        actions={
          listed !== null && held.has('forms.forms.design') && sites.length > 0 ? (
            <CreateFormDialog
              t={t}
              csrfToken={csrfToken}
              sites={sites}
              currentSite={currentSite}
              roles={roleOptions}
            />
          ) : null
        }
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : forms.length === 0 ? (
          <EmptyState
            icon={<ClipboardList aria-hidden />}
            title={t['forms.empty.title']}
            description={t['forms.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {forms.map((form) => (
                <li
                  key={form.id}
                  className="space-y-1.5 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <Link
                      href={`/forms/${form.id}`}
                      className="min-w-0 truncate font-medium text-link"
                    >
                      <bdi>{form.name}</bdi>
                    </Link>
                    <Badge tone={STATUS_TONE[form.status]}>{t[`formStatus.${form.status}`]}</Badge>
                  </div>
                  <p className="flex min-w-0 flex-wrap gap-x-2 text-sm text-fg-muted">
                    <Ltr className="truncate">{form.key}</Ltr>
                    {siteName(form.siteId) === '' ? null : (
                      <span className="truncate">
                        · <bdi>{siteName(form.siteId)}</bdi>
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={COLUMNS} className="min-w-[40rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['forms.col.name']}</TableHead>
                    <TableHead>{t['forms.col.key']}</TableHead>
                    <TableHead>{t['forms.col.site']}</TableHead>
                    <TableHead>{t['forms.col.status']}</TableHead>
                    <TableHead numeric>{t['forms.col.revisions']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forms.map((form) => (
                    <TableRow key={form.id}>
                      <TableCell className="truncate">
                        <Link href={`/forms/${form.id}`} className="font-medium text-link">
                          <bdi>{form.name}</bdi>
                        </Link>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <Ltr>{form.key}</Ltr>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <bdi>{siteName(form.siteId)}</bdi>
                      </TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[form.status]}>
                          {t[`formStatus.${form.status}`]}
                        </Badge>
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {formatNumber(form.latestRevisionNumber, locale)}
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
