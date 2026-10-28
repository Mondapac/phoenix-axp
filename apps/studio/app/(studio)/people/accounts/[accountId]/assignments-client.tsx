'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Select,
  Switch,
} from '@phoenix/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../../_client/api';
import { failureMessage } from '../../../../_lib/api-answer';
import type { RoleScope } from '../../../../_lib/people';
import { fill, type Messages } from '../../../../_i18n/messages';
import { ConfirmDialog } from '../../../_components/confirm-dialog';

// Granting and revoking an account's roles. A grant's level is its role's scope: a tenant role
// is granted tenant-wide, a site role at one site, optionally with its descendants (ADR-0018).

const GRANT_FORM = 'grant-role';

export interface GrantableRole {
  readonly id: string;
  readonly name: string;
  readonly scope: RoleScope;
}

export function GrantRoleDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly accountId: string;
  readonly roles: readonly GrantableRole[];
  readonly sites: readonly { readonly id: string; readonly name: string; readonly depth: number }[];
}) {
  const { t, csrfToken, accountId, roles, sites } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [descendants, setDescendants] = useState(false);
  const [missing, setMissing] = useState<'role' | 'site' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const role = roles.find((r) => r.id === roleId);
  const atSite = role?.scope === 'site';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (role === undefined) return setMissing('role');
    if (atSite && siteId === null) return setMissing('site');
    setBusy(true);
    const answer = await callApi('POST', 'identity/role-assignments', csrfToken, {
      accountId,
      roleId: role.id,
      placement:
        atSite && siteId !== null
          ? { level: 'site', siteId, includeDescendants: descendants }
          : { level: 'tenant' },
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setProblem(t[failureMessage(answer)]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRoleId(null);
          setSiteId(null);
          setDescendants(false);
          setMissing(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            {t['grant.open']}
          </Button>
        }
      />
      <DialogContent
        title={t['grant.title']}
        description={t['grant.description']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button
              type="submit"
              form={GRANT_FORM}
              disabled={busy || (atSite && sites.length === 0)}
            >
              {busy ? t['common.saving'] : t['grant.submit']}
            </Button>
          </>
        }
      >
        <form id={GRANT_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['grant.role']} invalid={missing === 'role'} error={t['common.required']}>
            <Select
              placeholder={t['grant.rolePlaceholder']}
              value={roleId}
              onValueChange={(value) => {
                setRoleId(value);
                setMissing(null);
              }}
              options={roles.map((r) => ({
                value: r.id,
                label: `${r.name} · ${t[r.scope === 'site' ? 'scope.site' : 'scope.tenant']}`,
              }))}
            />
          </Field>
          {atSite && sites.length === 0 ? <Alert tone="warning">{t['grant.noSites']}</Alert> : null}
          {atSite && sites.length > 0 ? (
            <>
              <Field
                label={t['grant.site']}
                invalid={missing === 'site'}
                error={t['common.required']}
              >
                <Select
                  placeholder={t['grant.sitePlaceholder']}
                  value={siteId}
                  onValueChange={(value) => {
                    setSiteId(value);
                    setMissing(null);
                  }}
                  options={sites.map((s) => ({
                    value: s.id,
                    label: `${'  '.repeat(Math.max(0, s.depth))}${s.name}`,
                  }))}
                />
              </Field>
              <Switch
                label={t['grant.descendants']}
                checked={descendants}
                onCheckedChange={setDescendants}
              />
            </>
          ) : null}
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeAssignmentButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly assignmentId: string;
  readonly roleName: string;
}) {
  const { t, csrfToken, assignmentId, roleName } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" className="text-critical!">
              {t['assignments.revoke']}
            </Button>
          }
        />
      }
      title={t['assignments.revoke.title']}
      description={fill(t['assignments.revoke.description'], { name: roleName })}
      confirmLabel={t['assignments.revoke.confirm']}
      onConfirm={() => callApi('DELETE', `identity/role-assignments/${assignmentId}`, csrfToken)}
      onDone={() => router.refresh()}
    />
  );
}
