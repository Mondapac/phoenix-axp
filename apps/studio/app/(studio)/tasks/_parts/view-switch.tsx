'use client';
import { buttonClasses } from '@phoenix/ui';
import Link from 'next/link';
import type { Messages } from '../../../_i18n/messages';

// The inbox's two views for a supervisor: its own tasks, or every open task at its sites.

export function ViewSwitch({
  t,
  view,
}: {
  readonly t: Messages;
  readonly view: 'mine' | 'supervised';
}) {
  return (
    <nav aria-label={t['tasks.views']} className="flex flex-wrap gap-2">
      <Link
        href="/tasks"
        aria-current={view === 'mine' ? 'page' : undefined}
        className={buttonClasses(view === 'mine' ? 'secondary' : 'ghost', 'sm')}
      >
        {t['tasks.view.mine']}
      </Link>
      <Link
        href="/tasks?view=supervised"
        aria-current={view === 'supervised' ? 'page' : undefined}
        className={buttonClasses(view === 'supervised' ? 'secondary' : 'ghost', 'sm')}
      >
        {t['tasks.view.supervised']}
      </Link>
    </nav>
  );
}
