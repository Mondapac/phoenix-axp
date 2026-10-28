import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
} from '@phoenix/ui';
import { notFound } from 'next/navigation';
import {
  KIND_TONE,
  kindLabel,
  moduleLabel,
  permissionGroups,
  permissionLabel,
  roleName,
  scopeLabel,
  type PermissionDeclaration,
  type PermissionGroup,
  type Role,
} from '../../../../_lib/people';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { RolePermissionsEditor } from './role-client';

// One role and the keys it confers. A system role holds every key of its scope by definition;
// a custom role's keys are edited here with `identity.roles.manage`.

interface Props {
  readonly params: Promise<{ readonly roleId: string }>;
}

/** The groups of `groups` narrowed to the keys in `keys`, empty groups dropped. */
function only(groups: readonly PermissionGroup[], keys: ReadonlySet<string>): PermissionGroup[] {
  return groups
    .map((group) => ({ ...group, keys: group.keys.filter((k) => keys.has(k.key)) }))
    .filter((group) => group.keys.length > 0);
}

export default async function RolePage({ params }: Props) {
  const { roleId } = await params;
  const { t, held, csrfToken } = await studioSession();
  const [roles, catalogue] = await Promise.all([
    readForPage<{ items: Role[] }>('identity/roles'),
    readForPage<{ items: PermissionDeclaration[] }>('identity/permissions'),
  ]);
  const role = roles?.items.find((r) => r.id === roleId);
  if (roles !== null && role === undefined) notFound();

  const crumbs = (
    <PageCrumbs
      t={t}
      items={[
        { label: t['menu.people'], href: '/people' },
        { label: t['roles.title'], href: '/people/roles' },
        { label: role === undefined ? '…' : roleName(t, role.key) },
      ]}
    />
  );
  if (role === undefined || catalogue === null) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={crumbs} title={t['roles.title']} />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const groups = permissionGroups(catalogue.items, role.scope);
  const conferred = role.kind === 'system' ? groups : only(groups, new Set(role.permissionKeys));
  // A key the catalogue no longer declares grants nothing; it is still shown as stored.
  const declared = new Set(catalogue.items.map((d) => d.key));
  const undeclared = role.permissionKeys.filter((key) => !declared.has(key));
  const editable = role.kind === 'custom' && held.has('identity.roles.manage');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={crumbs}
        title={roleName(t, role.key)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={KIND_TONE[role.kind]}>{kindLabel(t, role.kind)}</Badge>
            <Badge tone="neutral">{scopeLabel(t, role.scope)}</Badge>
          </span>
        }
      />
      {role.kind === 'system' ? <Alert tone="info">{t['role.systemNote']}</Alert> : null}
      {role.kind === 'default' ? <Alert tone="info">{t['role.defaultNote']}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t['rolePermissions.title']}</CardTitle>
        </CardHeader>
        <CardContent>
          {editable ? (
            <RolePermissionsEditor
              t={t}
              csrfToken={csrfToken}
              roleId={role.id}
              version={role.version}
              groups={groups}
              held={[...held]}
              initial={role.permissionKeys.filter((key) => declared.has(key))}
              undeclared={undeclared}
            />
          ) : (
            <div className="space-y-5">
              {conferred.map((group) => (
                <div key={group.module} className="space-y-2">
                  <p className="text-xs font-medium text-fg-muted">
                    {moduleLabel(t, group.module)}
                  </p>
                  <ul className="grid gap-2 text-sm sm:grid-cols-2">
                    {group.keys.map((declaration) => (
                      <li key={declaration.key} className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-fg">
                          {permissionLabel(t, declaration.key)}
                        </span>
                        {declaration.protected ? (
                          <Badge tone="warning">{t['role.protected']}</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {undeclared.length > 0 ? (
                <ul className="space-y-1 text-sm text-fg-muted">
                  {undeclared.map((key) => (
                    <li key={key} dir="ltr" className="text-start">
                      {key}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
