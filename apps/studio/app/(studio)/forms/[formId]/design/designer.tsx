'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardToolbar,
  cn,
  directionOf,
  EmptyState,
  Field,
  formatNumber,
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  Switch,
  TextInput,
  buttonClasses,
} from '@phoenix/ui';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  Columns3,
  Hash,
  List,
  Mail,
  PanelTop,
  Plus,
  Save,
  Text,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { callApi } from '../../../../_client/api';
import { failureMessage } from '../../../../_lib/api-answer';
import {
  addNode,
  checkDesign,
  compileDesign,
  emptyDesign,
  FIELD_TYPES,
  fieldsOf,
  findNode,
  MAX_COLUMNS,
  MAX_DEPTH,
  MAX_STEPS,
  moveNode,
  newField,
  parseDesign,
  PORTAL_MODES,
  removeNode,
  updateField,
  updateLabels,
  type Choice,
  type DesignField,
  type DesignNode,
  type DesignStep,
  type FieldType,
  type FormDesign,
  type SavedField,
  type Texts,
} from '../../../../_lib/form-design';
import { languageName } from '../../../../_lib/forms';
import { fill, type Messages } from '../../../../_i18n/messages';
import { PreviewForm } from '../../forms-client';

// The form designer, step 1 (phase 2 review, owner decision 2026-10-27): fields, rows of up to
// four columns with chosen widths, nested sections and steps, labels in each of the tenant's
// languages, and a live preview with the portal's renderer in the tenant's calendar. Saving
// writes a new immutable revision (POST forms/forms/:id/revisions); publishing is on the form's
// page. Order is changed with move buttons (keyboard and touch friendly); drag and drop comes
// with a later designer step.

const ICON: Readonly<Record<FieldType, LucideIcon>> = {
  text: TextCursorInput,
  textarea: Text,
  email: Mail,
  number: Hash,
  integer: Hash,
  date: Calendar,
  select: List,
  checkbox: CheckSquare,
};

const mint = () => crypto.randomUUID();

export interface DesignerProps {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly formId: string;
  readonly revision: {
    readonly jsonSchema: Record<string, unknown>;
    readonly uiSchema: Record<string, unknown>;
    readonly fields: readonly SavedField[] | null;
  } | null;
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly calendar: string;
  readonly timeZone: string;
}

type Panel = 'structure' | 'properties' | 'preview';

export function Designer(props: DesignerProps) {
  const { t, defaultLocale } = props;
  const router = useRouter();
  const locales = useMemo(
    () => [defaultLocale, ...props.locales.filter((l) => l !== defaultLocale)],
    [defaultLocale, props.locales],
  );
  const [design, setDesign] = useState<FormDesign | null>(() =>
    props.revision === null
      ? emptyDesign(mint)
      : parseDesign(
          props.revision.jsonSchema,
          props.revision.uiSchema,
          props.revision.fields,
          defaultLocale,
          mint,
        ),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('structure');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'critical'; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [previewLocale, setPreviewLocale] = useState(defaultLocale);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const compiled = useMemo(
    () => (design === null ? null : compileDesign(design, defaultLocale)),
    [design, defaultLocale],
  );

  if (design === null) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">{t['designer.notEditable']}</Alert>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setDesign(emptyDesign(mint))}>
            {t['designer.startOver']}
          </Button>
        </div>
        {props.revision === null ? null : (
          <Card>
            <CardContent className="pt-5">
              <PreviewForm
                t={t}
                jsonSchema={props.revision.jsonSchema}
                uiSchema={props.revision.uiSchema}
                locale={defaultLocale}
                calendar={props.calendar}
                timeZone={props.timeZone}
              />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const change = (next: FormDesign | null) => {
    if (next === null) return;
    setDesign(next);
    setDirty(true);
    setNotice(null);
  };
  const select = (key: string) => {
    setSelected(key);
    setPanel('properties');
  };
  const takenNames = () => new Set(fieldsOf(design).map((field) => field.name));
  const addTo = (container: string, what: FieldType | 'row' | 'section') => {
    let node: DesignNode;
    if (what === 'row') {
      const first = newField(mint, 'text', takenNames());
      node = { kind: 'row', key: mint(), fields: [first] };
      change(addNode(design, container, node));
      setSelected(first.key);
      return;
    }
    if (what === 'section') node = { kind: 'section', key: mint(), labels: {}, children: [] };
    else node = newField(mint, what, takenNames());
    change(addNode(design, container, node));
    setSelected(node.key);
  };

  async function save() {
    if (design === null || compiled === null) return;
    const issues = checkDesign(design, defaultLocale);
    const nameOf = (key: string | null) => {
      const found = key === null ? null : findNode(design, key);
      return found !== null && 'kind' in found.node && found.node.kind === 'field'
        ? found.node.name
        : '';
    };
    setProblems(
      issues.map((issue) => fill(t[`problem.${issue.problem}`], { name: nameOf(issue.key) })),
    );
    if (issues.length > 0) {
      if (issues[0]?.key) setSelected(issues[0].key);
      return;
    }
    setBusy(true);
    setNotice(null);
    const answer = await callApi<{ number: number; fields: SavedField[] }>(
      'POST',
      `forms/forms/${props.formId}/revisions`,
      props.csrfToken,
      compiled,
    );
    setBusy(false);
    if (!answer.ok) {
      setNotice({ tone: 'critical', text: t[failureMessage(answer)] });
      return;
    }
    // The API minted ids for new fields: keep them, so the next save is not a new field.
    const ids = new Map(answer.body.fields.map((field) => [field.name, field]));
    setDesign((current) => {
      if (current === null) return current;
      let next = current;
      for (const field of fieldsOf(current)) {
        const saved = ids.get(field.name);
        if (saved !== undefined) next = updateField(next, field.key, { fieldId: saved.id });
      }
      return next;
    });
    setDirty(false);
    setNotice({
      tone: 'success',
      text: fill(t['designer.saved'], { number: formatNumber(answer.body.number, defaultLocale) }),
    });
    router.refresh();
  }

  const panels: { id: Panel; label: string }[] = [
    { id: 'structure', label: t['designer.structure'] },
    { id: 'properties', label: t['designer.properties'] },
    { id: 'preview', label: t['designer.preview'] },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-muted"
          aria-live="polite"
        >
          {dirty ? <Badge tone="warning">{t['designer.unsaved']}</Badge> : null}
        </div>
        <Button onClick={() => void save()} disabled={busy}>
          <Save aria-hidden />
          {busy ? t['common.saving'] : t['designer.save']}
        </Button>
      </div>
      {notice === null ? null : <Alert tone={notice.tone}>{notice.text}</Alert>}
      {problems.length === 0 ? null : (
        <Alert tone="critical" title={t['designer.problems']}>
          <ul className="list-disc space-y-0.5 ps-5">
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div
        role="group"
        aria-label={t['designer.title']}
        className="grid grid-cols-3 gap-1 rounded-control border border-line bg-subtle p-1 lg:ms-auto lg:w-[calc(50%-0.5rem)] lg:grid-cols-2"
      >
        {panels.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={panel === item.id}
            onClick={() => setPanel(item.id)}
            className={cn(
              'h-9 cursor-pointer truncate rounded-control px-2 text-sm font-medium text-fg-muted',
              panel === item.id && 'bg-surface text-fg shadow-card',
              // On a wide screen the structure is always shown: its button goes, and the
              // properties stand in for it.
              item.id === 'structure' && 'lg:hidden',
              item.id === 'properties' &&
                panel === 'structure' &&
                'lg:bg-surface lg:text-fg lg:shadow-card',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-4">
          <Card className={cn(panel !== 'structure' && 'max-lg:hidden')}>
            <CardHeader>
              <CardTitle>{t['designer.structure']}</CardTitle>
              <CardToolbar>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={design.steps.length >= MAX_STEPS}
                  onClick={() => {
                    const step: DesignStep = { key: mint(), labels: {}, children: [] };
                    change({ steps: [...design.steps, step] });
                    setSelected(step.key);
                  }}
                >
                  <Plus aria-hidden />
                  {t['designer.addStep']}
                </Button>
              </CardToolbar>
            </CardHeader>
            <CardContent className="space-y-4">
              {design.steps.length > 1 ? (
                <p className="text-xs text-fg-muted">{t['designer.stepsHint']}</p>
              ) : null}
              {design.steps.map((step, index) => (
                <StepBlock
                  key={step.key}
                  t={t}
                  step={step}
                  index={index}
                  count={design.steps.length}
                  locale={defaultLocale}
                  selected={selected}
                  onSelect={select}
                  onAdd={addTo}
                  onMove={(key, by) => change(moveNode(design, key, by))}
                  onRemove={(key) => {
                    change(removeNode(design, key));
                    if (selected === key) setSelected(null);
                  }}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card
            className={cn(
              panel === 'preview' && 'hidden',
              panel === 'structure' && 'max-lg:hidden',
            )}
          >
            <CardHeader>
              <CardTitle>{t['designer.properties']}</CardTitle>
            </CardHeader>
            <CardContent>
              <Properties
                t={t}
                design={design}
                selected={selected}
                locales={locales}
                defaultLocale={defaultLocale}
                onChange={change}
              />
            </CardContent>
          </Card>
          <Card className={cn(panel !== 'preview' && 'hidden')}>
            <CardHeader>
              <CardTitle>{t['designer.preview']}</CardTitle>
              {locales.length > 1 ? (
                <CardToolbar>
                  <div className="w-40">
                    <Select
                      aria-label={t['designer.previewLocale']}
                      value={previewLocale}
                      onValueChange={(value) => {
                        if (value !== null) setPreviewLocale(value);
                      }}
                      options={locales.map((locale) => ({
                        value: locale,
                        label: languageName(locale, defaultLocale),
                      }))}
                    />
                  </div>
                </CardToolbar>
              ) : null}
            </CardHeader>
            <CardContent>
              {compiled === null || fieldsOf(design).length === 0 ? (
                <EmptyState title={t['designer.previewEmpty']} />
              ) : (
                <div dir={directionOf(previewLocale)} lang={previewLocale}>
                  <PreviewForm
                    key={previewLocale}
                    t={t}
                    jsonSchema={compiled.jsonSchema}
                    uiSchema={compiled.uiSchema}
                    locale={previewLocale}
                    calendar={props.calendar}
                    timeZone={props.timeZone}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Structure ----------------------------------------------------------------------------------

interface TreeHandlers {
  readonly t: Messages;
  readonly locale: string;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly onAdd: (container: string, what: FieldType | 'row' | 'section') => void;
  readonly onMove: (key: string, by: -1 | 1) => void;
  readonly onRemove: (key: string) => void;
}

const titleOf = (labels: Texts, locale: string, fallback: string) =>
  (labels[locale] ?? '').trim() || fallback;

function StepBlock(props: TreeHandlers & { step: DesignStep; index: number; count: number }) {
  const { t, step } = props;
  const multi = props.count > 1;
  const number = formatNumber(props.index + 1, props.locale);
  return (
    <section className={cn('space-y-2', multi && 'rounded-card border border-line p-3')}>
      {multi ? (
        <NodeBar
          {...props}
          nodeKey={step.key}
          icon={PanelTop}
          title={titleOf(step.labels, props.locale, fill(t['designer.step'], { number }))}
          first={props.index === 0}
          last={props.index === props.count - 1}
        />
      ) : null}
      <NodeList {...props} nodes={step.children} depth={0} />
      {step.children.length === 0 ? (
        <p className="py-2 text-sm text-fg-muted">{t['designer.emptyStep']}</p>
      ) : null}
      <AddMenu {...props} container={step.key} canSection />
    </section>
  );
}

function NodeList(props: TreeHandlers & { nodes: readonly DesignNode[]; depth: number }) {
  const { t, nodes } = props;
  if (nodes.length === 0) return null;
  return (
    <ul className="space-y-2">
      {nodes.map((node, index) => {
        const edges = { first: index === 0, last: index === nodes.length - 1 };
        if (node.kind === 'field') {
          return (
            <li key={node.key}>
              <FieldBar {...props} field={node} {...edges} />
            </li>
          );
        }
        if (node.kind === 'row') {
          return (
            <li
              key={node.key}
              className="space-y-2 rounded-card border border-dashed border-line-strong p-2"
            >
              <NodeBar
                {...props}
                nodeKey={node.key}
                icon={Columns3}
                title={t['designer.row']}
                hint={fill(t['designer.rowHint'], { max: formatNumber(MAX_COLUMNS, props.locale) })}
                selectable={false}
                {...edges}
              />
              <ul className="space-y-2">
                {node.fields.map((field, column) => (
                  <li key={field.key} className="min-w-0">
                    <FieldBar
                      {...props}
                      field={field}
                      first={column === 0}
                      last={column === node.fields.length - 1}
                    />
                  </li>
                ))}
              </ul>
              {node.fields.length < MAX_COLUMNS ? (
                <AddMenu {...props} container={node.key} label={t['designer.addToRow']} />
              ) : null}
            </li>
          );
        }
        return (
          <li key={node.key} className="space-y-2 rounded-card border border-line bg-page p-2">
            <NodeBar
              {...props}
              nodeKey={node.key}
              icon={PanelTop}
              title={titleOf(node.labels, props.locale, t['designer.section'])}
              {...edges}
            />
            <div className="ps-3">
              <NodeList {...props} nodes={node.children} depth={props.depth + 1} />
            </div>
            <AddMenu {...props} container={node.key} canSection={props.depth + 1 < MAX_DEPTH} />
          </li>
        );
      })}
    </ul>
  );
}

function FieldBar(props: TreeHandlers & { field: DesignField; first: boolean; last: boolean }) {
  const { t, field } = props;
  return (
    <NodeBar
      {...props}
      nodeKey={field.key}
      icon={ICON[field.type]}
      title={titleOf(field.labels, props.locale, field.name)}
      hint={t[`fieldType.${field.type}`]}
      required={field.required}
    />
  );
}

function NodeBar(
  props: TreeHandlers & {
    nodeKey: string;
    icon: LucideIcon;
    title: string;
    hint?: string;
    required?: boolean;
    selectable?: boolean;
    first: boolean;
    last: boolean;
  },
) {
  const { t, nodeKey } = props;
  const Icon = props.icon;
  const active = props.selected === nodeKey;
  const selectable = props.selectable ?? true;
  const label = (
    <>
      <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <bdi>{props.title}</bdi>
        {props.required ? (
          <span className="text-critical" aria-hidden>
            {' *'}
          </span>
        ) : null}
      </span>
      {props.hint === undefined ? null : (
        <span className="shrink-0 truncate text-xs text-fg-muted max-sm:hidden">{props.hint}</span>
      )}
    </>
  );
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-control border bg-surface ps-2',
        active ? 'border-accent ring-1 ring-accent' : 'border-line',
      )}
    >
      {selectable ? (
        <button
          type="button"
          aria-pressed={active}
          aria-label={fill(t['designer.select'], { name: props.title })}
          onClick={() => props.onSelect(nodeKey)}
          className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 text-start text-sm text-fg"
        >
          {label}
        </button>
      ) : (
        <span className="flex h-10 min-w-0 flex-1 items-center gap-2 text-sm font-medium text-fg">
          {label}
        </span>
      )}
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          className={buttonClasses('ghost', 'icon-sm')}
          aria-label={t['designer.moveUp']}
          disabled={props.first}
          onClick={() => props.onMove(nodeKey, -1)}
        >
          <ArrowUp aria-hidden />
        </button>
        <button
          type="button"
          className={buttonClasses('ghost', 'icon-sm')}
          aria-label={t['designer.moveDown']}
          disabled={props.last}
          onClick={() => props.onMove(nodeKey, 1)}
        >
          <ArrowDown aria-hidden />
        </button>
        <button
          type="button"
          className={cn(buttonClasses('ghost', 'icon-sm'), 'text-critical')}
          aria-label={t['designer.remove']}
          onClick={() => props.onRemove(nodeKey)}
        >
          <Trash2 aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AddMenu(
  props: TreeHandlers & { container: string; canSection?: boolean; label?: string },
) {
  const { t } = props;
  const inRow = props.label !== undefined;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="sm" className="text-accent-fg" />}>
        <Plus aria-hidden />
        {props.label ?? t['designer.add']}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuGroupLabel>{t['designer.addField']}</MenuGroupLabel>
        {FIELD_TYPES.map((type) => {
          const Icon = ICON[type];
          return (
            <MenuItem key={type} onClick={() => props.onAdd(props.container, type)}>
              <Icon aria-hidden />
              {t[`fieldType.${type}`]}
            </MenuItem>
          );
        })}
        {inRow ? null : (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => props.onAdd(props.container, 'row')}>
              <Columns3 aria-hidden />
              {t['designer.addRow']}
            </MenuItem>
            {props.canSection ? (
              <MenuItem onClick={() => props.onAdd(props.container, 'section')}>
                <PanelTop aria-hidden />
                {t['designer.addSection']}
              </MenuItem>
            ) : null}
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

// Properties ---------------------------------------------------------------------------------

function Properties(props: {
  readonly t: Messages;
  readonly design: FormDesign;
  readonly selected: string | null;
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly onChange: (design: FormDesign) => void;
}) {
  const { t, design, locales, defaultLocale } = props;
  const found = props.selected === null ? null : findNode(design, props.selected);
  if (found === null) return <p className="text-sm text-fg-muted">{t['designer.noSelection']}</p>;
  const node = found.node;
  const language = (locale: string) => languageName(locale, defaultLocale);

  if (!('kind' in node) || node.kind === 'section') {
    return (
      <div className="space-y-4">
        <TextsFields
          t={t}
          labelKey="designer.label"
          value={node.labels}
          locales={locales}
          language={language}
          onChange={(labels) => props.onChange(updateLabels(design, node.key, labels))}
        />
      </div>
    );
  }
  if (node.kind === 'row')
    return <p className="text-sm text-fg-muted">{t['designer.noSelection']}</p>;

  const field = node;
  const inRow = isInRow(design, field.key);
  const set = (patch: Partial<Omit<DesignField, 'kind' | 'key'>>) =>
    props.onChange(updateField(design, field.key, patch));
  const optionalNumber = (text: string): number | undefined => {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : undefined;
  };
  const isText = field.type === 'text' || field.type === 'textarea' || field.type === 'email';
  const isNumber = field.type === 'number' || field.type === 'integer';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t['designer.type']}>
          <Select
            value={field.type}
            onValueChange={(type) => {
              if (type === null) return;
              set({ type: type as FieldType, ...(type === 'checkbox' ? { required: false } : {}) });
            }}
            options={FIELD_TYPES.map((type) => ({ value: type, label: t[`fieldType.${type}`] }))}
          />
        </Field>
        <Field label={t['designer.name']} description={t['designer.nameHint']}>
          <TextInput
            value={field.name}
            dir="ltr"
            className="text-start font-mono"
            autoComplete="off"
            maxLength={64}
            onChange={(event) => set({ name: event.currentTarget.value.trim() })}
          />
        </Field>
      </div>
      <TextsFields
        t={t}
        labelKey="designer.label"
        value={field.labels}
        locales={locales}
        language={language}
        onChange={(labels) => set({ labels })}
      />
      <TextsFields
        t={t}
        labelKey="designer.helpText"
        value={field.descriptions}
        locales={locales}
        language={language}
        onChange={(descriptions) => set({ descriptions })}
      />
      {field.type === 'checkbox' ? null : (
        <Switch
          label={t['designer.required']}
          checked={field.required}
          onCheckedChange={(required) => set({ required })}
        />
      )}
      {isText ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t['designer.minLength']}
            value={field.minLength}
            onChange={(text) => set({ minLength: optionalNumber(text) })}
          />
          <NumberField
            label={t['designer.maxLength']}
            value={field.maxLength}
            onChange={(text) => set({ maxLength: optionalNumber(text) })}
          />
          {field.type === 'email' ? null : (
            <Field label={t['designer.pattern']} className="sm:col-span-2">
              <TextInput
                value={field.pattern ?? ''}
                dir="ltr"
                className="text-start font-mono"
                onChange={(event) =>
                  set({
                    pattern:
                      event.currentTarget.value === '' ? undefined : event.currentTarget.value,
                  })
                }
              />
            </Field>
          )}
        </div>
      ) : null}
      {isNumber ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t['designer.minimum']}
            value={field.minimum}
            onChange={(text) => set({ minimum: optionalNumber(text) })}
          />
          <NumberField
            label={t['designer.maximum']}
            value={field.maximum}
            onChange={(text) => set({ maximum: optionalNumber(text) })}
          />
        </div>
      ) : null}
      {field.type === 'select' ? (
        <Choices
          t={t}
          choices={field.choices}
          locales={locales}
          language={language}
          onChange={(choices) => set({ choices })}
        />
      ) : null}
      {inRow ? (
        <Field label={t['designer.span']}>
          <Select
            value={field.span === null ? 'auto' : String(field.span)}
            onValueChange={(value) => {
              if (value !== null) set({ span: value === 'auto' ? null : Number(value) });
            }}
            options={[
              { value: 'auto', label: t['designer.spanAuto'] },
              ...Array.from({ length: 12 }, (_, i) => ({
                value: String(i + 1),
                label: formatNumber(i + 1, defaultLocale),
              })),
            ]}
          />
        </Field>
      ) : null}
      <fieldset className="space-y-3 border-t border-line pt-4">
        <legend className="mb-2 text-sm font-semibold text-fg">{t['designer.access']}</legend>
        <div className="space-y-1">
          <Switch
            label={t['designer.sensitive']}
            checked={field.sensitive}
            onCheckedChange={(sensitive) => set({ sensitive })}
          />
          <p className="text-xs text-fg-muted">{t['designer.sensitiveHint']}</p>
        </div>
        <Field label={t['designer.portal']}>
          <Select
            value={field.portal}
            onValueChange={(portal) => {
              if (portal !== null) set({ portal: portal as DesignField['portal'] });
            }}
            options={PORTAL_MODES.map((mode) => ({ value: mode, label: t[`portalMode.${mode}`] }))}
          />
        </Field>
      </fieldset>
    </div>
  );
}

function isInRow(design: FormDesign, key: string): boolean {
  const walk = (nodes: readonly DesignNode[]): boolean =>
    nodes.some((node) =>
      node.kind === 'row'
        ? node.fields.some((field) => field.key === key)
        : node.kind === 'section' && walk(node.children),
    );
  return design.steps.some((step) => walk(step.children));
}

function TextsFields(props: {
  readonly t: Messages;
  readonly labelKey: 'designer.label' | 'designer.helpText';
  readonly value: Texts;
  readonly locales: readonly string[];
  readonly language: (locale: string) => string;
  readonly onChange: (value: Texts) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {props.locales.map((locale) => (
        <Field
          key={locale}
          label={fill(props.t[props.labelKey], { language: props.language(locale) })}
        >
          <TextInput
            value={props.value[locale] ?? ''}
            dir={directionOf(locale)}
            lang={locale}
            normalise="text"
            maxLength={300}
            onChange={(event) =>
              props.onChange({ ...props.value, [locale]: event.currentTarget.value })
            }
          />
        </Field>
      ))}
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (text: string) => void;
}) {
  return (
    <Field label={props.label}>
      <TextInput
        value={props.value === undefined ? '' : String(props.value)}
        inputMode="decimal"
        dir="ltr"
        normalise="identifier"
        className="text-start"
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </Field>
  );
}

function Choices(props: {
  readonly t: Messages;
  readonly choices: readonly Choice[];
  readonly locales: readonly string[];
  readonly language: (locale: string) => string;
  readonly onChange: (choices: Choice[]) => void;
}) {
  const { t, choices } = props;
  const setAt = (index: number, choice: Choice) =>
    props.onChange(choices.map((each, i) => (i === index ? choice : each)));
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium text-fg">{t['designer.choices']}</legend>
      {choices.map((choice, index) => (
        <div key={index} className="space-y-3 rounded-control border border-line p-3">
          <div className="flex items-end gap-2">
            <Field label={t['designer.choiceValue']} className="flex-1">
              <TextInput
                value={choice.value}
                dir="ltr"
                className="text-start font-mono"
                maxLength={100}
                onChange={(event) => setAt(index, { ...choice, value: event.currentTarget.value })}
              />
            </Field>
            <button
              type="button"
              className={cn(buttonClasses('ghost', 'icon'), 'text-critical')}
              aria-label={t['designer.remove']}
              onClick={() => props.onChange(choices.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden />
            </button>
          </div>
          <TextsFields
            t={t}
            labelKey="designer.label"
            value={choice.labels}
            locales={props.locales}
            language={props.language}
            onChange={(labels) => setAt(index, { ...choice, labels })}
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          props.onChange([...choices, { value: `option${choices.length + 1}`, labels: {} }])
        }
      >
        <Plus aria-hidden />
        {t['designer.addChoice']}
      </Button>
    </fieldset>
  );
}
