import Link from 'next/link';
import {
  Badge,
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
import { KeyRound } from 'lucide-react';
import { fill } from '../../../_i18n/messages';
import {
  KIND_TONE,
  kindLabel,
  permissionGroups,
  scopeLabel,
  roleName,
  type PermissionDeclaration,
  type Role,
} from '../../../_lib/people';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { CreateRoleDialog } from './roles-client';

// The tenant's roles (GET identity/roles): system, default and custom. Creating a custom role
// needs `identity.roles.manage`.

const ROLE_COLUMNS = ['40%', '20%', '20%', '20%'];

export default async function RolesPage() {
  const { t, tenant, held, csrfToken } = await studioSession();
  const roles = await readForPage<{ items: Role[] }>('identity/roles');
  const manage = held.has('identity.roles.manage');
  const catalogue = manage
    ? await readForPage<{ items: PermissionDeclaration[] }>('identity/permissions')
    : null;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[{ label: t['menu.people'], href: '/people' }, { label: t['roles.title'] }]}
          />
        }
        title={t['roles.title']}
        description={t['roles.description']}
        actions={
          catalogue === null ? null : (
            <CreateRoleDialog
              t={t}
              csrfToken={csrfToken}
              groups={{
                tenant: permissionGroups(catalogue.items, 'tenant'),
                site: permissionGroups(catalogue.items, 'site'),
              }}
              held={[...held]}
            />
          )
        }
      />
      <Card>
        {roles === null ? (
          <NoAccess t={t} />
        ) : roles.items.length === 0 ? (
          <EmptyState
            icon={<KeyRound aria-hidden />}
            title={t['roles.empty.title']}
            description={t['roles.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {roles.items.map((role) => (
                <li
                  key={role.id}
                  className="space-y-2 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <Link
                      href={`/people/roles/${role.id}`}
                      className="truncate font-medium text-fg hover:text-accent"
                    >
                      {roleName(t, role.key)}
                    </Link>
                    <Badge tone={KIND_TONE[role.kind]}>{kindLabel(t, role.kind)}</Badge>
                  </div>
                  <p className="text-sm text-fg-muted">
                    {scopeLabel(t, role.scope)}
                    {' · '}
                    {fill(t['rolePermissions.count'], {
                      count:
                        role.kind === 'system'
                          ? t['roles.allKeys']
                          : formatNumber(role.permissionKeys.length, tenant.defaultLocale),
                    })}
                  </p>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={ROLE_COLUMNS} className="min-w-[34rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['roles.col.name']}</TableHead>
                    <TableHead>{t['roles.col.kind']}</TableHead>
                    <TableHead>{t['roles.col.scope']}</TableHead>
                    <TableHead numeric>{t['roles.col.keys']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.items.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <Link
                          href={`/people/roles/${role.id}`}
                          className="block truncate font-medium text-fg hover:text-accent"
                        >
                          {roleName(t, role.key)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge tone={KIND_TONE[role.kind]}>{kindLabel(t, role.kind)}</Badge>
                      </TableCell>
                      <TableCell className="text-fg-muted">{scopeLabel(t, role.scope)}</TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {role.kind === 'system'
                          ? t['roles.allKeys']
                          : formatNumber(role.permissionKeys.length, tenant.defaultLocale)}
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
