'use client';
import { Alert, Badge, Field, Ltr, Select, Switch, TextInput } from '@phoenix/ui';
import { useEffect, useState } from 'react';
import { fill, type MessageKey, type Messages } from '../../../_i18n/messages';
import {
  attributesOf,
  isOutcomeCode,
  outcomeCondition,
  outcomeOfCondition,
  outcomesOf,
  parseTimerDuration,
  settingsOf,
  settingsProblems,
  timerDurationOf,
  type Assignment,
  type Deadline,
  type TaskAttributes,
  type TaskSettingsForm,
  type Wait,
} from '../../../_lib/process';

// The side panel of the modeler: the settings of the selected element. Owner decision D3 (a
// role's queue at the instance's site by default, or one person), D4 (a deadline in calendar or
// working days), the form of a step (slice 2.6) and the outcome a gateway branches on. Each
// change is one command on bpmn-js's stack (undo works).

export interface PickOption {
  readonly value: string;
  readonly label: string;
}

/** What the panel reads of the selected element (or of the process, with nothing selected). */
export type Selection =
  | { readonly kind: 'process'; readonly key: string; readonly name: string }
  | {
      readonly kind: 'userTask';
      readonly id: string;
      readonly name: string;
      readonly formKey: string | null;
      readonly attributes: TaskAttributes;
    }
  | {
      readonly kind: 'startEvent';
      readonly id: string;
      readonly name: string;
      readonly formKey: string | null;
    }
  | {
      readonly kind: 'timer';
      readonly id: string;
      readonly name: string;
      readonly duration: string | null;
    }
  | {
      readonly kind: 'flow';
      readonly id: string;
      readonly name: string;
      /** The flow leaves an exclusive or inclusive gateway: it may carry a condition. */
      readonly fromSplit: boolean;
      readonly condition: string | null;
      readonly isDefault: boolean;
    }
  | { readonly kind: 'other'; readonly id: string; readonly name: string; readonly type: string };

export type Change =
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'attributes'; readonly value: ReturnType<typeof attributesOf> }
  | { readonly kind: 'formKey'; readonly value: string | null }
  | { readonly kind: 'timer'; readonly value: string | null }
  | { readonly kind: 'condition'; readonly value: string | null }
  | { readonly kind: 'default'; readonly value: boolean };

const NONE = '__none__';

export function ElementPanel(props: {
  readonly t: Messages;
  readonly selection: Selection;
  readonly roles: readonly PickOption[] | null;
  readonly people: readonly PickOption[] | null;
  readonly forms: readonly PickOption[] | null;
  /** Every outcome code the model's user tasks offer, for a gateway's flows. */
  readonly outcomes: readonly string[];
  readonly onChange: (change: Change) => void;
}) {
  const { t, selection, onChange } = props;
  const heading: MessageKey =
    selection.kind === 'process'
      ? 'modeler.panel.process'
      : selection.kind === 'userTask'
        ? 'modeler.panel.userTask'
        : selection.kind === 'startEvent'
          ? 'modeler.panel.start'
          : selection.kind === 'timer'
            ? 'modeler.panel.timer'
            : selection.kind === 'flow'
              ? 'modeler.panel.flow'
              : 'modeler.panel.element';
  const key = selection.kind === 'process' ? 'process' : selection.id;

  return (
    <div className="space-y-4" key={key}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-fg">{t[heading]}</h2>
        <p className="text-xs text-fg-muted">
          {selection.kind === 'process' ? (
            <Ltr>{selection.key}</Ltr>
          ) : (
            <>
              {t['modeler.panel.id']} <Ltr>{selection.id}</Ltr>
            </>
          )}
        </p>
      </div>
      <NameField
        t={t}
        label={selection.kind === 'process' ? t['modeler.processName'] : t['modeler.name']}
        value={selection.name}
        onCommit={(value) => onChange({ kind: 'name', value })}
      />
      {selection.kind === 'userTask' ? (
        <>
          <FormPick
            t={t}
            label={t['modeler.form']}
            description={t['modeler.form.taskHelp']}
            forms={props.forms}
            value={selection.formKey}
            onChange={(value) => onChange({ kind: 'formKey', value })}
          />
          <TaskSettings
            t={t}
            attributes={selection.attributes}
            roles={props.roles}
            people={props.people}
            onChange={(value) => onChange({ kind: 'attributes', value: attributesOf(value) })}
          />
        </>
      ) : null}
      {selection.kind === 'startEvent' ? (
        <FormPick
          t={t}
          label={t['modeler.startForm']}
          description={t['modeler.form.startHelp']}
          forms={props.forms}
          value={selection.formKey}
          onChange={(value) => onChange({ kind: 'formKey', value })}
        />
      ) : null}
      {selection.kind === 'timer' ? (
        <TimerField
          t={t}
          duration={selection.duration}
          onChange={(value) => onChange({ kind: 'timer', value })}
        />
      ) : null}
      {selection.kind === 'flow' && selection.fromSplit ? (
        <FlowCondition
          t={t}
          condition={selection.condition}
          isDefault={selection.isDefault}
          outcomes={props.outcomes}
          onChange={onChange}
        />
      ) : null}
      {selection.kind === 'process' ? (
        <p className="text-xs leading-relaxed text-fg-muted">{t['modeler.panel.processHelp']}</p>
      ) : null}
    </div>
  );
}

/** A text committed on blur or Enter, so typing makes one undo step, not one per letter. */
function NameField(props: {
  readonly t: Messages;
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => {
    if (text.trim() !== props.value) props.onCommit(text.trim());
  };
  return (
    <Field label={props.label}>
      <TextInput
        normalise="text"
        value={text}
        maxLength={255}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

function FormPick(props: {
  readonly t: Messages;
  readonly label: string;
  readonly description: string;
  readonly forms: readonly PickOption[] | null;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
}) {
  const { t, forms, value } = props;
  if (forms === null) {
    return (
      <Field label={props.label} description={t['modeler.form.noAccess']}>
        <TextInput
          dir="ltr"
          value={value ?? ''}
          onChange={(event) => {
            const next = event.currentTarget.value.trim();
            props.onChange(next === '' ? null : next);
          }}
        />
      </Field>
    );
  }
  const options = [
    { value: NONE, label: t['modeler.form.none'] },
    ...forms,
    ...(value !== null && !forms.some((form) => form.value === value)
      ? [{ value, label: fill(t['modeler.form.unknown'], { key: value }) }]
      : []),
  ];
  return (
    <Field label={props.label} description={props.description}>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => props.onChange(next === NONE || next === null ? null : next)}
        options={options}
      />
    </Field>
  );
}

function TaskSettings(props: {
  readonly t: Messages;
  readonly attributes: TaskAttributes;
  readonly roles: readonly PickOption[] | null;
  readonly people: readonly PickOption[] | null;
  readonly onChange: (settings: TaskSettingsForm) => void;
}) {
  const { t, roles, people } = props;
  const saved = settingsOf(props.attributes);
  // A role or person chosen as the kind writes nothing until its id is picked: keep the choice.
  const [pendingKind, setPendingKind] = useState<'role' | 'person' | null>(null);
  const settings: TaskSettingsForm =
    saved.assignment.kind === 'supervisor' && pendingKind === 'role'
      ? { ...saved, assignment: { kind: 'role', roleId: null } }
      : saved.assignment.kind === 'supervisor' && pendingKind === 'person'
        ? { ...saved, assignment: { kind: 'person', accountId: null } }
        : saved;
  const [outcomesText, setOutcomesText] = useState(settings.outcomes.join(', '));
  const problems = settingsProblems(settings);
  const update = (patch: Partial<TaskSettingsForm>) => props.onChange({ ...settings, ...patch });
  const { assignment, deadline } = settings;

  return (
    <>
      <section className="space-y-3 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-fg">{t['modeler.assignment']}</h3>
        <Field label={t['modeler.assignment.kind']}>
          <Select
            value={assignment.kind}
            onValueChange={(kind) => {
              const next: Assignment =
                kind === 'role'
                  ? { kind: 'role', roleId: null }
                  : kind === 'person'
                    ? { kind: 'person', accountId: null }
                    : { kind: 'supervisor' };
              setPendingKind(next.kind === 'supervisor' ? null : next.kind);
              update({ assignment: next });
            }}
            options={[
              { value: 'role', label: t['modeler.assignment.role'] },
              { value: 'person', label: t['modeler.assignment.person'] },
              { value: 'supervisor', label: t['modeler.assignment.supervisor'] },
            ]}
          />
        </Field>
        {assignment.kind === 'role' ? (
          <IdPick
            t={t}
            label={t['modeler.queueRole']}
            description={t['modeler.queueRole.help']}
            options={roles}
            value={assignment.roleId}
            invalid={problems.includes('role-missing')}
            onChange={(roleId) => update({ assignment: { kind: 'role', roleId } })}
          />
        ) : null}
        {assignment.kind === 'person' ? (
          <IdPick
            t={t}
            label={t['modeler.person']}
            description={t['modeler.person.help']}
            options={people}
            value={assignment.accountId}
            invalid={problems.includes('person-missing')}
            onChange={(accountId) => update({ assignment: { kind: 'person', accountId } })}
          />
        ) : null}
        {assignment.kind === 'supervisor' ? (
          <p className="text-xs text-fg-muted">{t['modeler.assignment.supervisorHelp']}</p>
        ) : null}
      </section>

      <section className="space-y-3 border-t border-line pt-4">
        <Switch
          label={t['modeler.deadline']}
          checked={deadline !== null}
          onCheckedChange={(on) =>
            update({ deadline: on ? { amount: 2, unit: 'days', count: 'working' } : null })
          }
        />
        {deadline === null ? null : (
          <DeadlineFields
            t={t}
            deadline={deadline}
            invalid={problems.includes('deadline-invalid')}
            onChange={(next) => update({ deadline: next })}
          />
        )}
        {deadline === null ? null : (
          <IdPick
            t={t}
            label={t['modeler.escalation']}
            description={t['modeler.escalation.help']}
            options={roles}
            value={settings.escalationRoleId}
            invalid={problems.includes('escalation-invalid')}
            optional
            onChange={(escalationRoleId) => update({ escalationRoleId })}
          />
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-4">
        <Field
          label={t['modeler.outcomes']}
          description={t['modeler.outcomes.help']}
          invalid={problems.some((p) => p.startsWith('outcome'))}
          error={
            problems.includes('outcomes-too-many')
              ? t['modeler.outcomes.tooMany']
              : problems.includes('outcome-repeated')
                ? t['modeler.outcomes.repeated']
                : t['modeler.outcomes.invalid']
          }
        >
          <TextInput
            dir="ltr"
            value={outcomesText}
            placeholder="approve, reject"
            onChange={(event) => setOutcomesText(event.currentTarget.value)}
            onBlur={() => update({ outcomes: outcomesOf(outcomesText.toLowerCase()) })}
          />
        </Field>
        {settings.outcomes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {settings.outcomes.map((code) => (
              <Badge key={code} tone={isOutcomeCode(code) ? 'accent' : 'critical'}>
                <Ltr>{code}</Ltr>
              </Badge>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function DeadlineFields(props: {
  readonly t: Messages;
  readonly deadline: Deadline;
  readonly invalid: boolean;
  readonly onChange: (deadline: Deadline) => void;
}) {
  const { t, deadline } = props;
  const [amount, setAmount] = useState(String(deadline.amount));
  useEffect(() => setAmount(String(deadline.amount)), [deadline.amount]);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field
        label={t['modeler.deadline.amount']}
        invalid={props.invalid}
        error={t['modeler.deadline.invalid']}
      >
        <TextInput
          normalise="identifier"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.currentTarget.value)}
          onBlur={() => props.onChange({ ...deadline, amount: Number(amount) || 0 })}
        />
      </Field>
      <Field label={t['modeler.deadline.unit']}>
        <Select
          value={deadline.unit}
          onValueChange={(unit) =>
            props.onChange(
              unit === 'hours'
                ? { ...deadline, unit: 'hours', count: 'calendar' }
                : { ...deadline, unit: 'days' },
            )
          }
          options={[
            { value: 'days', label: t['modeler.deadline.days'] },
            { value: 'hours', label: t['modeler.deadline.hours'] },
          ]}
        />
      </Field>
      {deadline.unit === 'days' ? (
        <Field
          label={t['modeler.deadline.count']}
          description={t['modeler.deadline.countHelp']}
          className="col-span-2"
        >
          <Select
            value={deadline.count}
            onValueChange={(count) =>
              props.onChange({ ...deadline, count: count === 'calendar' ? 'calendar' : 'working' })
            }
            options={[
              { value: 'working', label: t['modeler.deadline.working'] },
              { value: 'calendar', label: t['modeler.deadline.calendar'] },
            ]}
          />
        </Field>
      ) : null}
    </div>
  );
}

/** A role or a person by id: a list where the member may read one, else the id typed. */
function IdPick(props: {
  readonly t: Messages;
  readonly label: string;
  readonly description: string;
  readonly options: readonly PickOption[] | null;
  readonly value: string | null;
  readonly invalid?: boolean;
  readonly optional?: boolean;
  readonly onChange: (value: string | null) => void;
}) {
  const { t, options, value } = props;
  if (options === null) {
    return (
      <Field
        label={props.label}
        description={t['modeler.pick.noAccess']}
        invalid={props.invalid}
        error={t['common.required']}
      >
        <TextInput
          dir="ltr"
          value={value ?? ''}
          onChange={(event) => {
            const next = event.currentTarget.value.trim().toLowerCase();
            props.onChange(next === '' ? null : next);
          }}
        />
      </Field>
    );
  }
  return (
    <Field
      label={props.label}
      description={props.description}
      invalid={props.invalid}
      error={t['common.required']}
    >
      <Select
        value={value ?? (props.optional ? NONE : null)}
        placeholder={t['modeler.pick.placeholder']}
        onValueChange={(next) => props.onChange(next === NONE || next === null ? null : next)}
        options={[
          ...(props.optional ? [{ value: NONE, label: t['modeler.pick.none'] }] : []),
          ...options,
          ...(value !== null && !options.some((option) => option.value === value)
            ? [{ value, label: t['modeler.pick.unknown'] }]
            : []),
        ]}
      />
    </Field>
  );
}

function TimerField(props: {
  readonly t: Messages;
  readonly duration: string | null;
  readonly onChange: (duration: string | null) => void;
}) {
  const { t } = props;
  const wait: Wait = parseTimerDuration(props.duration ?? undefined) ?? { amount: 1, unit: 'days' };
  const [amount, setAmount] = useState(String(wait.amount));
  const valid = /^[1-9][0-9]{0,3}$/.test(amount);
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <p className="text-xs text-fg-muted">{t['modeler.timer.help']}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t['modeler.timer.amount']}
          invalid={!valid}
          error={t['modeler.timer.invalid']}
        >
          <TextInput
            normalise="identifier"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.currentTarget.value)}
            onBlur={() => {
              if (valid) props.onChange(timerDurationOf({ ...wait, amount: Number(amount) }));
            }}
          />
        </Field>
        <Field label={t['modeler.deadline.unit']}>
          <Select
            value={wait.unit}
            onValueChange={(unit) =>
              props.onChange(
                timerDurationOf({
                  amount: valid ? Number(amount) : wait.amount,
                  unit: unit === 'minutes' || unit === 'hours' ? unit : 'days',
                }),
              )
            }
            options={[
              { value: 'minutes', label: t['modeler.timer.minutes'] },
              { value: 'hours', label: t['modeler.deadline.hours'] },
              { value: 'days', label: t['modeler.deadline.days'] },
            ]}
          />
        </Field>
      </div>
      {props.duration === null ? <Alert tone="warning">{t['modeler.timer.missing']}</Alert> : null}
    </section>
  );
}

function FlowCondition(props: {
  readonly t: Messages;
  readonly condition: string | null;
  readonly isDefault: boolean;
  readonly outcomes: readonly string[];
  readonly onChange: (change: Change) => void;
}) {
  const { t, condition, outcomes } = props;
  const code = outcomeOfCondition(condition ?? undefined);
  const custom = condition !== null && code === null;
  const OTHER = '__other__';
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <Switch
        label={t['modeler.flow.default']}
        checked={props.isDefault}
        onCheckedChange={(value) => props.onChange({ kind: 'default', value })}
      />
      {props.isDefault ? (
        <p className="text-xs text-fg-muted">{t['modeler.flow.defaultHelp']}</p>
      ) : (
        <Field label={t['modeler.flow.when']} description={t['modeler.flow.whenHelp']}>
          <Select
            value={custom ? OTHER : (code ?? NONE)}
            onValueChange={(next) => {
              if (next === OTHER) return;
              props.onChange({
                kind: 'condition',
                value: next === NONE || next === null ? null : outcomeCondition(next),
              });
            }}
            options={[
              { value: NONE, label: t['modeler.flow.always'] },
              ...[...new Set([...outcomes, ...(code === null ? [] : [code])])].map((value) => ({
                value,
                label: fill(t['modeler.flow.outcome'], { code: value }),
              })),
              ...(custom ? [{ value: OTHER, label: t['modeler.flow.custom'] }] : []),
            ]}
          />
        </Field>
      )}
    </section>
  );
}
