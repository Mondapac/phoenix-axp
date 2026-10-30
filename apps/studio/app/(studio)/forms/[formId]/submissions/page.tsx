import Link from 'next/link';
import {
  Badge,
  buttonClasses,
  Card,
  CardDescription,
  CardHeader,
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
import { Inbox } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatInstantDateTime } from '../../../../_lib/format';
import { answerText, isInboxCursor, type FormView, type InboxPage } from '../../../../_lib/forms';
import { isId } from '../../../../_lib/structure';
import { fill } from '../../../../_i18n/messages';
import { readApi } from '../../../../_server/panel';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';

// The form inbox (GET forms/forms/:id/submissions, slice 2.5), newest first, a page at a time.
// Only the answers the reader's field modes show arrive (ADR-0024); the first two visible
// fields are shown as columns, the rest on the submission's page.

interface Props {
  readonly params: Promise<{ readonly formId: string }>;
  readonly searchParams: Promise<{ readonly after?: string }>;
}

const PAGE_SIZE = 25;

export default async function InboxPage({ params, searchParams }: Props) {
  const { formId } = await params;
  const { after } = await searchParams;
  const { t, tenant } = await studioSession();
  if (!isId(formId)) notFound();
  const cursor = isInboxCursor(after) ? after : null;
  const query = `limit=${PAGE_SIZE}${cursor === null ? '' : `&after=${encodeURIComponent(cursor)}`}`;
  const [page, formRead] = await Promise.all([
    readForPage<InboxPage>(`forms/forms/${formId}/submissions?${query}`),
    // The form's name for the heading; a reader without `forms.forms.view` sees none.
    readApi<FormView>(`forms/forms/${formId}`),
  ]);
  const name = formRead.ok ? formRead.body.name : '';
  const dates = {
    locale: tenant.defaultLocale,
    calendar: tenant.calendar,
    timeZone: tenant.timeZone,
  };
  const shown = (page?.fields ?? []).slice(0, 2);
  const columns = [
    '24%',
    '18%',
    ...shown.map(() => `${Math.floor(44 / Math.max(shown.length, 1))}%`),
    '14%',
  ];
  if (shown.length === 0) columns.splice(2, 0, '44%');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[
              { label: t['forms.title'], href: '/forms' },
              ...(name === '' ? [] : [{ label: name, href: `/forms/${formId}` }]),
              { label: t['inbox.title'] },
            ]}
          />
        }
        title={t['inbox.title']}
        description={name === '' ? undefined : fill(t['inbox.description'], { name })}
      />
      <Card>
        {page === null ? (
          <NoAccess t={t} />
        ) : page.items.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden />}
            title={t['inbox.empty.title']}
            description={t['inbox.empty.description']}
          />
        ) : (
          <>
            <CardHeader>
              <CardDescription>{t['inbox.hiddenNote']}</CardDescription>
            </CardHeader>
            <ul className="sm:hidden">
              {page.items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-1 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/forms/submissions/${item.id}`}
                      className="min-w-0 truncate font-medium text-link"
                    >
                      {formatInstantDateTime(item.submittedAt, dates)}
                    </Link>
                    <Badge tone="neutral">{t[`channel.${item.channel}`]}</Badge>
                  </div>
                  {shown.map((field) => (
                    <p key={field.id} className="truncate text-sm text-fg-muted">
                      <bdi>{answerText(item.answers[field.id])}</bdi>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={columns} className="min-w-[40rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['inbox.col.submitted']}</TableHead>
                    <TableHead>{t['inbox.col.channel']}</TableHead>
                    {shown.length === 0 ? <TableHead>{t['inbox.col.status']}</TableHead> : null}
                    {shown.map((field) => (
                      <TableHead key={field.id}>
                        <bdi className="font-mono">{field.name}</bdi>
                      </TableHead>
                    ))}
                    <TableHead numeric>{t['inbox.col.revision']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="truncate">
                        <Link
                          href={`/forms/submissions/${item.id}`}
                          className="font-medium text-link"
                        >
                          {formatInstantDateTime(item.submittedAt, dates)}
                        </Link>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        {t[`channel.${item.channel}`]}
                      </TableCell>
                      {shown.length === 0 ? (
                        <TableCell className="truncate text-fg-muted">
                          {item.erased ? t['submission.erased'] : t['submissionStatus.received']}
                        </TableCell>
                      ) : null}
                      {shown.map((field) => (
                        <TableCell key={field.id} className="truncate">
                          <bdi>{answerText(item.answers[field.id])}</bdi>
                        </TableCell>
                      ))}
                      <TableCell numeric className="text-fg-muted">
                        {formatNumber(item.revisionNumber, tenant.defaultLocale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
      {page === null || (cursor === null && page.next === null) ? null : (
        <nav className="flex flex-wrap justify-between gap-2" aria-label={t['inbox.title']}>
          {cursor === null ? (
            <span />
          ) : (
            <Link href={`/forms/${formId}/submissions`} className={buttonClasses('outline', 'sm')}>
              {t['inbox.first']}
            </Link>
          )}
          {page.next === null ? null : (
            <Link
              href={`/forms/${formId}/submissions?after=${encodeURIComponent(page.next)}`}
              className={buttonClasses('outline', 'sm')}
            >
              {t['inbox.next']}
            </Link>
          )}
        </nav>
      )}
    </PageContainer>
  );
}
