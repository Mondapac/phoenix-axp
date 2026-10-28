import Link from 'next/link';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardToolbar,
  EmptyState,
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
import { KeyRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatInstantDate } from '../../../../_lib/format';
import {
  canOfferDisable,
  canOfferGrant,
  grantableRoles,
  roleName,
  type Role,
  type RoleAssignment,
  type StaffAccount,
  whereOf,
} from '../../../../_lib/people';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { AccountStatus } from '../account-status';
import { DisableAccountButton } from '../accounts-client';
import { GrantRoleDialog, RevokeAssignmentButton } from './assignments-client';

// One staff account: its details and the roles granted to it (ADR-0018 decision 6). Granting
// and revoking need `identity.role-assignments.manage`; the API checks the grant's reach.

interface Props {
  readonly params: Promise<{ readonly accountId: string }>;
}

const ASSIGNMENT_COLUMNS = ['36%', '36%', '18%', '10%'];

export default async function AccountPage({ params }: Props) {
  const { accountId: id } = await params;
  const session = await studioSession();
  const { t, tenant, held, csrfToken, sites } = session;
  const listed = await readForPage<{ items: StaffAccount[] }>('identity/staff-accounts');
  const account = listed?.items.find((a) => a.id === id);
  if (listed !== null && account === undefined) notFound();

  const crumbs = (
    <PageCrumbs
      t={t}
      items={[
        { label: t['menu.people'], href: '/people' },
        { label: t['accounts.title'], href: '/people/accounts' },
        { label: account === undefined ? '…' : <Ltr>{account.username}</Ltr> },
      ]}
    />
  );
  if (account === undefined) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={crumbs} title={t['accounts.title']} />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const seesRoles = held.has('identity.roles.view');
  const [assignments, roles] = seesRoles
    ? await Promise.all([
        readForPage<{ items: RoleAssignment[] }>(`identity/staff-accounts/${id}/role-assignments`),
        readForPage<{ items: Role[] }>('identity/roles'),
      ])
    : [null, null];
  const grants = held.has('identity.role-assignments.manage');
  const dates = { ...tenant, locale: tenant.defaultLocale };

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={crumbs}
        title={<Ltr>{account.username}</Ltr>}
        actions={
          held.has('identity.accounts.manage') && canOfferDisable(account, session.accountId) ? (
            <DisableAccountButton
              t={t}
              csrfToken={csrfToken}
              account={{ id: account.id, username: account.username, version: account.version }}
            />
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t['account.details']}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['accounts.col.source']}</dt>
              <dd className="text-fg">
                {account.source === 'local' ? t['source.local'] : t['source.directory']}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['accounts.col.status']}</dt>
              <dd>
                <AccountStatus t={t} account={account} />
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['account.signedIn']}</dt>
              <dd className="text-fg">{account.signedInOnce ? t['common.yes'] : t['common.no']}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['accounts.col.created']}</dt>
              <dd className="text-fg">{formatInstantDate(account.createdAt, dates)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {seesRoles ? (
        <Card>
          <CardHeader>
            <div className="min-w-0 space-y-1">
              <CardTitle>{t['assignments.title']}</CardTitle>
              <CardDescription>{t['assignments.description']}</CardDescription>
            </div>
            {grants && roles !== null && canOfferGrant(account) ? (
              <CardToolbar>
                <GrantRoleDialog
                  t={t}
                  csrfToken={csrfToken}
                  accountId={account.id}
                  roles={grantableRoles(roles.items).map((role) => ({
                    id: role.id,
                    name: roleName(t, role.key),
                    scope: role.scope,
                  }))}
                  sites={sites}
                />
              </CardToolbar>
            ) : null}
          </CardHeader>
          {grants && !canOfferGrant(account) ? (
            <div className="px-5 pt-4">
              <Alert tone="info">
                {account.status === 'disabled'
                  ? t['assignments.accountDisabled']
                  : t['assignments.notLinked']}
              </Alert>
            </div>
          ) : null}
          {assignments === null ? (
            <NoAccess t={t} />
          ) : assignments.items.length === 0 ? (
            <EmptyState icon={<KeyRound aria-hidden />} title={t['assignments.empty']} />
          ) : (
            <>
              <ul className="sm:hidden">
                {assignments.items.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="space-y-1 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <Link
                        href={`/people/roles/${assignment.roleId}`}
                        className="truncate font-medium text-fg hover:text-accent"
                      >
                        {roleName(t, assignment.roleKey)}
                      </Link>
                      {grants ? (
                        <RevokeAssignmentButton
                          t={t}
                          csrfToken={csrfToken}
                          assignmentId={assignment.id}
                          roleName={roleName(t, assignment.roleKey)}
                        />
                      ) : null}
                    </div>
                    <p className="text-sm text-fg-muted">{whereOf(t, assignment, sites)}</p>
                    <p className="text-xs text-fg-muted">
                      {formatInstantDate(assignment.createdAt, dates)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="max-sm:hidden">
                <Table columns={ASSIGNMENT_COLUMNS} className="min-w-[36rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t['assignments.col.role']}</TableHead>
                      <TableHead>{t['assignments.col.where']}</TableHead>
                      <TableHead>{t['assignments.col.granted']}</TableHead>
                      <TableHead className="relative text-end">
                        <span className="sr-only">{t['common.actions']}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.items.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell>
                          <Link
                            href={`/people/roles/${assignment.roleId}`}
                            className="font-medium text-fg hover:text-accent"
                          >
                            {roleName(t, assignment.roleKey)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {whereOf(t, assignment, sites)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-fg-muted">
                          {formatInstantDate(assignment.createdAt, dates)}
                        </TableCell>
                        <TableCell className="text-end">
                          {grants ? (
                            <RevokeAssignmentButton
                              t={t}
                              csrfToken={csrfToken}
                              assignmentId={assignment.id}
                              roleName={roleName(t, assignment.roleKey)}
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
      ) : null}
    </PageContainer>
  );
}
