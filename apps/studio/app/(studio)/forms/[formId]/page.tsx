import Link from 'next/link';
import {
  Badge,
  buttonClasses,
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
import { History, Inbox, PencilRuler } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatInstantDate } from '../../../_lib/format';
import { STATUS_TONE, type FormView, type RevisionView } from '../../../_lib/forms';
import { roleName, type Role } from '../../../_lib/people';
import { isId } from '../../../_lib/structure';
import { fill } from '../../../_i18n/messages';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import {
  PreviewRevisionButton,
  PublishRevisionButton,
  RenameFormDialog,
  RetireFormButton,
  SettingsDialog,
} from '../forms-client';

// One form (GET forms/forms/:id): its settings, its revisions and what can be done with them.
// Designing needs `forms.forms.design`; publishing, retiring and changing a published form's
// settings need `forms.forms.publish`; the inbox needs `forms.submission.read`. The API checks
// every key again.

interface Props {
  readonly params: Promise<{ readonly formId: string }>;
}

const REVISION_COLUMNS = ['22%', '30%', '22%', '26%'];

export default async function FormPage({ params }: Props) {
  const { formId } = await params;
  const { t, tenant, held, sites, csrfToken } = await studioSession();
  if (!isId(formId)) notFound();
  const form = await readForPage<FormView>(`forms/forms/${formId}`);
  const crumbsBase = [{ label: t['forms.title'], href: '/forms' }];
  if (form === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['forms.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const locale = tenant.defaultLocale;
  const dates = { locale, calendar: tenant.calendar, timeZone: tenant.timeZone };
  const design = held.has('forms.forms.design');
  const publish = held.has('forms.forms.publish');
  const revisions = [...form.revisions].sort((a, b) => b.number - a.number);
  const latest = revisions[0];
  // The two revisions a member previews most: the newest and the published one.
  const previewIds = [
    ...new Set(
      [latest?.id, form.publishedRevisionId].filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const [previews, roles] = await Promise.all([
    Promise.all(previewIds.map((id) => readForPage<RevisionView>(`forms/revisions/${id}`))),
    held.has('identity.roles.view') ? readForPage<{ items: Role[] }>('identity/roles') : null,
  ]);
  const previewOf = (id: string) => previews.find((revision) => revision?.id === id) ?? null;
  const roleOptions =
    roles === null
      ? null
      : roles.items.map((role) => ({ id: role.id, label: roleName(t, role.key) }));
  const roleLabels = form.policy.roleIds.map(
    (id) => roleOptions?.find((role) => role.id === id)?.label ?? id,
  );
  const siteName = sites.find((site) => site.id === form.siteId)?.name ?? '';
  const editSettings = form.status === 'draft' ? design || publish : publish;
  const numberText = (n: number) => formatNumber(n, locale);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: form.name }]} />}
        title={form.name}
        actions={
          <div className="flex flex-wrap gap-2">
            {held.has('forms.submission.read') ? (
              <Link href={`/forms/${form.id}/submissions`} className={buttonClasses('outline')}>
                <Inbox aria-hidden />
                {t['form.inbox']}
              </Link>
            ) : null}
            {design && form.status === 'draft' ? (
              <RenameFormDialog t={t} csrfToken={csrfToken} form={form} />
            ) : null}
            {publish && form.status === 'published' ? (
              <RetireFormButton t={t} csrfToken={csrfToken} form={form} />
            ) : null}
            {design ? (
              <Link href={`/forms/${form.id}/design`} className={buttonClasses('primary')}>
                <PencilRuler aria-hidden />
                {t['form.design']}
              </Link>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t['form.details']}</CardTitle>
          <CardToolbar>
            <Badge tone={STATUS_TONE[form.status]}>{t[`formStatus.${form.status}`]}</Badge>
          </CardToolbar>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['forms.col.key']}</dt>
              <dd className="truncate text-fg">
                <Ltr>{form.key}</Ltr>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['forms.col.site']}</dt>
              <dd className="truncate text-fg">
                <bdi>{siteName}</bdi>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['form.publicAddress']}</dt>
              <dd className="truncate text-fg">
                <Ltr>{`/f/${form.key}`}</Ltr>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['forms.col.revisions']}</dt>
              <dd className="text-fg">{numberText(form.latestRevisionNumber)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0 space-y-1">
            <CardTitle>{t['formSettings.title']}</CardTitle>
          </div>
          {editSettings ? (
            <CardToolbar>
              <SettingsDialog
                t={t}
                csrfToken={csrfToken}
                form={form}
                roles={roleOptions}
                asPublisher={publish}
              />
            </CardToolbar>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['formSettings.audience']}</dt>
              <dd className="text-fg">
                {t[`audience.${form.policy.audience}`]}
                {form.policy.audience === 'staff-roles' && roleLabels.length > 0 ? (
                  <span className="block text-fg-muted">
                    <bdi>{new Intl.ListFormat(locale).format(roleLabels)}</bdi>
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['formSettings.onBehalf']}</dt>
              <dd className="text-fg">
                {form.policy.allowOnBehalf ? t['common.yes'] : t['common.no']}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['formSettings.retention']}</dt>
              <dd className="text-fg">
                {form.retention.kind === 'forever'
                  ? t['retention.forever']
                  : fill(t['retention.days'], { days: numberText(form.retention.days) })}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0 space-y-1">
            <CardTitle>{t['revisions.title']}</CardTitle>
            <CardDescription>{t['revisions.description']}</CardDescription>
          </div>
        </CardHeader>
        {revisions.length === 0 ? (
          <EmptyState icon={<History aria-hidden />} title={t['revisions.empty']} />
        ) : (
          <>
            <ul className="sm:hidden">
              {revisions.map((revision) => (
                <li
                  key={revision.id}
                  className="space-y-2 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg">
                      {fill(t['revisions.number'], { number: numberText(revision.number) })}
                    </span>
                    {revision.id === form.publishedRevisionId ? (
                      <Badge tone="success">{t['revisions.current']}</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-fg-muted">
                    {formatInstantDate(revision.createdAt, dates)}
                  </p>
                  <RevisionActions revision={revision} />
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={REVISION_COLUMNS} className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['revisions.col.number']}</TableHead>
                    <TableHead>{t['revisions.col.created']}</TableHead>
                    <TableHead>{t['revisions.col.hash']}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t['common.actions']}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((revision) => (
                    <TableRow key={revision.id}>
                      <TableCell>
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {fill(t['revisions.number'], { number: numberText(revision.number) })}
                          {revision.id === form.publishedRevisionId ? (
                            <Badge tone="success">{t['revisions.current']}</Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        {formatInstantDate(revision.createdAt, dates)}
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <Ltr className="font-mono text-xs">{revision.contentHash.slice(0, 12)}</Ltr>
                      </TableCell>
                      <TableCell>
                        <RevisionActions revision={revision} />
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

  function RevisionActions({ revision }: { readonly revision: { id: string; number: number } }) {
    const preview = previewOf(revision.id);
    const publishable = publish && revision.id !== form?.publishedRevisionId;
    if (preview === null && !publishable) return null;
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {preview === null ? null : (
          <PreviewRevisionButton
            t={t}
            revision={preview}
            title={fill(t['revisions.previewTitle'], { number: numberText(revision.number) })}
            locale={locale}
            calendar={tenant.calendar}
            timeZone={tenant.timeZone}
          />
        )}
        {publishable && form !== null ? (
          <PublishRevisionButton
            t={t}
            csrfToken={csrfToken}
            formId={form.id}
            formVersion={form.version}
            revision={revision}
            numberText={numberText(revision.number)}
          />
        ) : null}
      </div>
    );
  }
}
