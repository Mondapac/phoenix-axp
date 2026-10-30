import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardToolbar,
  formatNumber,
  PageContainer,
  PageHeader,
} from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { formatInstantDateTime } from '../../../../_lib/format';
import {
  answerText,
  type FormView,
  type SubmissionView,
  type VisibleField,
} from '../../../../_lib/forms';
import { isId } from '../../../../_lib/structure';
import { readApi } from '../../../../_server/panel';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { EraseSubmissionButton } from './erase-button';

// One submission (GET forms/submissions/:id): its facts and the answers the reader may see
// (ADR-0024). Erasing its personal data on request needs `forms.submission.erase` (D5).

interface Props {
  readonly params: Promise<{ readonly submissionId: string }>;
}

export default async function SubmissionPage({ params }: Props) {
  const { submissionId } = await params;
  const { t, tenant, held, csrfToken } = await studioSession();
  if (!isId(submissionId)) notFound();
  const detail = await readForPage<{ submission: SubmissionView; fields: VisibleField[] }>(
    `forms/submissions/${submissionId}`,
  );
  const formRead =
    detail === null ? null : await readApi<FormView>(`forms/forms/${detail.submission.formId}`);
  const form = formRead?.ok ? formRead.body : null;
  const locale = tenant.defaultLocale;
  const dates = { locale, calendar: tenant.calendar, timeZone: tenant.timeZone };
  const crumbs = [
    { label: t['forms.title'], href: '/forms' },
    ...(form === null ? [] : [{ label: form.name, href: `/forms/${form.id}` }]),
    ...(detail === null
      ? []
      : [{ label: t['inbox.title'], href: `/forms/${detail.submission.formId}/submissions` }]),
    { label: t['submission.title'] },
  ];
  if (detail === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={crumbs} />}
          title={t['submission.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }
  const { submission, fields } = detail;
  const facts = [
    {
      label: t['inbox.col.submitted'],
      value: formatInstantDateTime(submission.submittedAt, dates),
    },
    { label: t['inbox.col.channel'], value: t[`channel.${submission.channel}`] },
    { label: t['inbox.col.revision'], value: formatNumber(submission.revisionNumber, locale) },
  ];
  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={crumbs} />}
        title={t['submission.title']}
        actions={
          held.has('forms.submission.erase') && !submission.erased ? (
            <EraseSubmissionButton t={t} csrfToken={csrfToken} submission={submission} />
          ) : null
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>{t['submission.details']}</CardTitle>
          <CardToolbar>
            <Badge tone={submission.erased ? 'warning' : 'success'}>
              {submission.erased ? t['submission.erased'] : t['submissionStatus.received']}
            </Badge>
          </CardToolbar>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0 space-y-1">
                <dt className="text-fg-muted">{fact.label}</dt>
                <dd className="text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t['submission.answers']}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {submission.erased ? <Alert tone="warning">{t['submission.erased']}</Alert> : null}
          {!submission.erased && fields.length === 0 ? (
            <p className="text-sm text-fg-muted">{t['submission.noAnswers']}</p>
          ) : null}
          {submission.erased || fields.length === 0 ? null : (
            <dl className="divide-y divide-line">
              {fields.map((field) => (
                <div key={field.id} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                  <dt className="truncate font-mono text-sm text-fg-muted">
                    <bdi>{field.name}</bdi>
                  </dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-fg sm:col-span-2">
                    <bdi>{answerText(submission.answers[field.id])}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs text-fg-muted">{t['inbox.hiddenNote']}</p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
