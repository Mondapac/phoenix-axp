'use client';
import { Badge, Checkbox } from '@phoenix/ui';
import type { Messages } from '../../../_i18n/messages';
import { moduleLabel, permissionLabel, type PermissionGroup } from '../../../_lib/people';

// The permission keys of a role, by module. A key the member does not hold is shown but cannot
// be chosen: a role confers only keys its author holds (GrantPolicy), and the API says so too.

export function PermissionPicker(props: {
  readonly t: Messages;
  readonly groups: readonly PermissionGroup[];
  readonly held: readonly string[];
  readonly chosen: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
  readonly invalid?: boolean;
  /** Hidden where a heading above already names the list (the role's page). */
  readonly legendHidden?: boolean;
}) {
  const { t, groups, held, chosen, onChange } = props;
  const holds = new Set(held);

  function toggle(key: string, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    onChange(next);
  }

  return (
    <fieldset className="relative min-w-0 space-y-4" aria-invalid={props.invalid || undefined}>
      <legend className={props.legendHidden ? 'sr-only' : 'mb-1 text-sm font-medium text-fg'}>
        {t['rolePermissions.title']}
      </legend>
      <p className="text-xs text-fg-muted">{t['rolePermissions.hint']}</p>
      {groups.map((group) => (
        <div key={group.module} className="space-y-2">
          <p className="text-xs font-medium text-fg-muted">{moduleLabel(t, group.module)}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.keys.map((declaration) => (
              <li key={declaration.key} className="flex min-w-0 items-center gap-2">
                <Checkbox
                  label={permissionLabel(t, declaration.key)}
                  checked={chosen.has(declaration.key)}
                  disabled={!holds.has(declaration.key) && !chosen.has(declaration.key)}
                  onCheckedChange={(on) => toggle(declaration.key, on)}
                />
                {declaration.protected ? (
                  <Badge tone="warning" title={t['role.protectedHint']}>
                    {t['role.protected']}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {props.invalid ? (
        <p className="text-xs text-critical">{t['rolePermissions.noneChosen']}</p>
      ) : null}
    </fieldset>
  );
}
