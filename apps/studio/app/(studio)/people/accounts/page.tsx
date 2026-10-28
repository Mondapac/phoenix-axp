import {
  Badge,
  Card,
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
import { Users } from 'lucide-react';
import { formatInstantDate } from '../../../_lib/format';
import { canOfferDisable, type StaffAccount } from '../../../_lib/people';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { AccountStatus } from './account-status';
import { CreateAccountDialog, DisableAccountButton } from './accounts-client';

// The tenant's staff accounts (GET identity/staff-accounts): who they are, how they sign in and
// whether they may. Adding a local account and disabling one need `identity.accounts.manage`.

const ACCOUNT_COLUMNS = ['34%', '20%', '20%', '16%', '10%'];

export default async function AccountsPage() {
  const { t, tenant, held, accountId, csrfToken } = await studioSession();
  const listed = await readForPage<{ items: StaffAccount[] }>('identity/staff-accounts');
  const manage = held.has('identity.accounts.manage');
  const dates = { ...tenant, locale: tenant.defaultLocale };

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[{ label: t['menu.people'], href: '/people' }, { label: t['accounts.title'] }]}
          />
        }
        title={t['accounts.title']}
        description={t['accounts.description']}
        actions={manage ? <CreateAccountDialog t={t} csrfToken={csrfToken} /> : null}
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : listed.items.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden />}
            title={t['accounts.empty.title']}
            description={t['accounts.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {listed.items.map((account) => (
                <li
                  key={account.id}
                  className="space-y-2 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <a
                        href={`/people/accounts/${account.id}`}
                        className="truncate font-medium text-fg hover:text-accent"
                      >
                        <Ltr>{account.username}</Ltr>
                      </a>
                      {account.id === accountId ? (
                        <Badge tone="accent">{t['accounts.you']}</Badge>
                      ) : null}
                    </span>
                    <AccountStatus t={t} account={account} />
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-fg-muted">
                    <span className="truncate">
                      {account.source === 'local' ? t['source.local'] : t['source.directory']}
                      {' · '}
                      {formatInstantDate(account.createdAt, dates)}
                    </span>
                    {manage && canOfferDisable(account, accountId) ? (
                      <DisableAccountButton
                        t={t}
                        csrfToken={csrfToken}
                        account={{
                          id: account.id,
                          username: account.username,
                          version: account.version,
                        }}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={ACCOUNT_COLUMNS} className="min-w-[40rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['accounts.col.username']}</TableHead>
                    <TableHead>{t['accounts.col.source']}</TableHead>
                    <TableHead>{t['accounts.col.status']}</TableHead>
                    <TableHead>{t['accounts.col.created']}</TableHead>
                    <TableHead className="relative text-end">
                      <span className="sr-only">{t['common.actions']}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.items.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          <a
                            href={`/people/accounts/${account.id}`}
                            className="truncate font-medium text-fg hover:text-accent"
                          >
                            <Ltr>{account.username}</Ltr>
                          </a>
                          {account.id === accountId ? (
                            <Badge tone="accent">{t['accounts.you']}</Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {account.source === 'local' ? t['source.local'] : t['source.directory']}
                      </TableCell>
                      <TableCell>
                        <AccountStatus t={t} account={account} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-fg-muted">
                        {formatInstantDate(account.createdAt, dates)}
                      </TableCell>
                      <TableCell className="text-end">
                        {manage && canOfferDisable(account, accountId) ? (
                          <DisableAccountButton
                            t={t}
                            csrfToken={csrfToken}
                            account={{
                              id: account.id,
                              username: account.username,
                              version: account.version,
                            }}
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
    </PageContainer>
  );
}
