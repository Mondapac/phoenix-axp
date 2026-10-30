import {
  Badge,
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
import { History, ListPlus, Pencil, Rows3 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatInstantDate } from '../../../_lib/format';
import {
  recordsPath,
  STATUS_TONE,
  type DefinitionDetail,
  type FieldView,
  type RevisionView,
} from '../../../_lib/objects';
import { isId } from '../../../_lib/structure';
import { fill, type Messages } from '../../../_i18n/messages';
import { readForPage, studioSession } from '../../../_server/session';
import { LinkButton } from '../../_components/link-button';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { PublishRevisionButton, RenameObjectDialog, RetireObjectButton } from '../objects-client';

// One Object definition (GET objects/definitions/:id): its details, the fields of its newest
// revision and every revision. Renaming and saving fields need `objects.definitions.design`;
// publishing and retiring need `objects.definitions.publish`. The API checks each at the
// definition's site again.

interface Props {
  readonly params: Promise<{ readonly definitionId: string }>;
}

const FIELD_COLUMNS = ['30%', '24%', '18%', '28%'];
const REVISION_COLUMNS = ['20%', '45%', '35%'];

function FieldFlags({ t, field }: { readonly t: Messages; readonly field: FieldView }) {
  return (
    <span className="flex flex-wrap gap-1">
      {field.required ? <Badge>{t['field.required']}</Badge> : null}
      {field.sensitive ? <Badge tone="warning">{t['field.sensitive']}</Badge> : null}
      {field.portal === undefined ? null : <Badge tone="info">{t[`portal.${field.portal}`]}</Badge>}
    </span>
  );
}

export default async function ObjectPage({ params }: Props) {
  const { definitionId } = await params;
  const { t, tenant, held, csrfToken, sites } = await studioSession();
  if (!isId(definitionId)) notFound();
  const detail = await readForPage<DefinitionDetail>(`objects/definitions/${definitionId}`);
  const crumbsBase = [{ label: t['objects.title'], href: '/objects' }];
  if (detail === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['objects.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const { definition, revisions } = detail;
  const latest = revisions[0];
  const revision =
    latest === undefined ? null : await readForPage<RevisionView>(`objects/revisions/${latest.id}`);
  const locale = tenant.defaultLocale;
  const dates = { locale, calendar: tenant.calendar, timeZone: tenant.timeZone };
  const published = revisions.find((r) => r.id === definition.publishedRevisionId);
  const design = held.has('objects.definitions.design');
  const publish = held.has('objects.definitions.publish');
  const site = sites.find((s) => s.id === definition.siteId);
  const number = (n: number) => formatNumber(n, locale);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: definition.name }]} />}
        title={<bdi>{definition.name}</bdi>}
        actions={
          <>
            {definition.status !== 'draft' && held.has('objects.record.read') ? (
              <LinkButton href={recordsPath(definition.key)} variant="outline">
                <Rows3 aria-hidden />
                {t['objects.openRecords']}
              </LinkButton>
            ) : null}
            {design ? (
              <RenameObjectDialog t={t} csrfToken={csrfToken} definition={definition} />
            ) : null}
            {publish && definition.status === 'published' ? (
              <RetireObjectButton t={t} csrfToken={csrfToken} definition={definition} />
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t['object.details']}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['objects.col.key']}</dt>
              <dd className="truncate text-fg">
                <Ltr>{definition.key}</Ltr>
              </dd>
            </div>
            {site === undefined ? null : (
              <div className="min-w-0 space-y-1">
                <dt className="text-fg-muted">{t['objects.col.site']}</dt>
                <dd className="truncate text-fg">
                  <bdi>{site.name}</bdi>
                </dd>
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['objects.col.status']}</dt>
              <dd>
                <Badge tone={STATUS_TONE[definition.status]}>
                  {t[`objectStatus.${definition.status}`]}
                </Badge>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['object.published']}</dt>
              <dd className="text-fg">
                {published === undefined ? t['object.none'] : number(published.number)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0 space-y-1">
            <CardTitle>{t['object.fields']}</CardTitle>
            <CardDescription>
              {latest === undefined
                ? t['object.fields.description']
                : fill(t['object.fields.latest'], { n: number(latest.number) })}
            </CardDescription>
          </div>
          {design ? (
            <CardToolbar>
              <LinkButton href={`/objects/${definition.id}/fields`} variant="outline" size="sm">
                {latest === undefined ? <ListPlus aria-hidden /> : <Pencil aria-hidden />}
                {latest === undefined ? t['object.defineFields'] : t['object.editFields']}
              </LinkButton>
            </CardToolbar>
          ) : null}
        </CardHeader>
        {revision === null || revision.fields.length === 0 ? (
          <EmptyState icon={<ListPlus aria-hidden />} title={t['object.fields.empty']} />
        ) : (
          <>
            <ul className="sm:hidden">
              {revision.fields.map((field) => (
                <li
                  key={field.id}
                  className="space-y-1.5 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-medium text-fg">
                      <bdi>{field.label}</bdi>
                    </span>
                    <span className="shrink-0 text-sm text-fg-muted">
                      {t[`fieldType.${field.type}`]}
                    </span>
                  </div>
                  <p className="truncate text-sm text-fg-muted">
                    <Ltr>{field.key}</Ltr>
                  </p>
                  <FieldFlags t={t} field={field} />
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={FIELD_COLUMNS} className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['fields.col.label']}</TableHead>
                    <TableHead>{t['fields.col.key']}</TableHead>
                    <TableHead>{t['fields.col.type']}</TableHead>
                    <TableHead>{t['fields.col.rules']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revision.fields.map((field) => (
                    <TableRow key={field.id}>
                      <TableCell className="truncate font-medium text-fg">
                        <bdi>{field.label}</bdi>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <Ltr>{field.key}</Ltr>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        {t[`fieldType.${field.type}`]}
                      </TableCell>
                      <TableCell>
                        <FieldFlags t={t} field={field} />
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
          <div className="min-w-0 space-y-1">
            <CardTitle>{t['object.revisions']}</CardTitle>
            <CardDescription>{t['object.revisions.description']}</CardDescription>
          </div>
        </CardHeader>
        {revisions.length === 0 ? (
          <EmptyState icon={<History aria-hidden />} title={t['object.revisions.empty']} />
        ) : (
          <div>
            <Table columns={REVISION_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t['revisions.col.number']}</TableHead>
                  <TableHead>{t['revisions.col.saved']}</TableHead>
                  <TableHead className="text-end">{t['common.actions']}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-fg">{number(r.number)}</TableCell>
                    <TableCell className="truncate text-fg-muted">
                      {formatInstantDate(r.createdAt, dates)}
                    </TableCell>
                    <TableCell className="text-end">
                      {r.id === definition.publishedRevisionId &&
                      definition.status === 'published' ? (
                        <Badge tone="success">{t['revision.current']}</Badge>
                      ) : publish ? (
                        <PublishRevisionButton
                          t={t}
                          csrfToken={csrfToken}
                          definition={definition}
                          revision={{ id: r.id, number: number(r.number) }}
                          size="sm"
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
