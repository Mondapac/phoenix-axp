'use client';
import { Alert, Button } from '@phoenix/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '../../../../_client/api';
import { failureMessage } from '../../../../_lib/api-answer';
import type { PermissionGroup } from '../../../../_lib/people';
import type { Messages } from '../../../../_i18n/messages';
import { PermissionPicker } from '../permission-picker';

// Replacing the keys of a custom role (PUT identity/roles/:id/permissions), at the version the
// page read: a change by someone else meanwhile answers `conflict.stale`.

export function RolePermissionsEditor(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly roleId: string;
  readonly version: number;
  readonly groups: readonly PermissionGroup[];
  readonly held: readonly string[];
  readonly initial: readonly string[];
}) {
  const { t, csrfToken, roleId, version, groups, held, initial } = props;
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(initial));
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'critical'; text: string } | null>(null);
  const changed = chosen.size !== initial.length || initial.some((key) => !chosen.has(key));

  async function save() {
    setNotice(null);
    if (chosen.size === 0) return setInvalid(true);
    setBusy(true);
    const answer = await callApi('PUT', `identity/roles/${roleId}/permissions`, csrfToken, {
      version,
      permissionKeys: [...chosen],
    });
    setBusy(false);
    if (answer.ok) {
      setNotice({ tone: 'success', text: t['role.saved'] });
      router.refresh();
    } else {
      setNotice({
        tone: 'critical',
        text:
          answer.code === 'identity.value.invalid' ? t['error.invalid'] : t[failureMessage(answer)],
      });
    }
  }

  return (
    <div className="space-y-5">
      <PermissionPicker
        t={t}
        groups={groups}
        held={held}
        chosen={chosen}
        invalid={invalid}
        legendHidden
        onChange={(next) => {
          setChosen(next);
          setInvalid(false);
          setNotice(null);
        }}
      />
      {notice === null ? null : <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex justify-end">
        <Button disabled={busy || !changed} onClick={() => void save()}>
          {busy ? t['common.saving'] : t['role.save']}
        </Button>
      </div>
    </div>
  );
}
