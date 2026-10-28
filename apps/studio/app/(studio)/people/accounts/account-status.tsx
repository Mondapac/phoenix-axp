import { Badge } from '@phoenix/ui';
import type { Messages } from '../../../_i18n/messages';
import type { StaffAccount } from '../../../_lib/people';

/** An account's status: disabled, awaiting its person's first sign-in, or active. */
export function AccountStatus({
  t,
  account,
}: {
  readonly t: Messages;
  readonly account: Pick<StaffAccount, 'status' | 'signedInOnce'>;
}) {
  if (account.status === 'disabled') return <Badge tone="critical">{t['status.disabled']}</Badge>;
  if (!account.signedInOnce) return <Badge tone="warning">{t['status.pending']}</Badge>;
  return <Badge tone="success">{t['status.active']}</Badge>;
}
