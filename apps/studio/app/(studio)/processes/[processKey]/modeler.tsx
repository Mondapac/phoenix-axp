'use client';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { Alert, Badge, Button, Card, Skeleton, formatNumber } from '@phoenix/ui';
import { Download, Maximize, Redo2, Rocket, Save, Undo2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { callApi } from '../../../_client/api';
import { fill, type Messages } from '../../../_i18n/messages';
import { failureMessage } from '../../../_lib/api-answer';
import {
  MAX_REQUEST_MODEL_BYTES,
  modelBytes,
  outcomesOf,
  type TaskAttributes,
} from '../../../_lib/process';
import type Modeler from 'bpmn-js/lib/Modeler';
import { MODDLE_EXTENSIONS, PHOENIX_MODELER_MODULE, translateModule } from './bpmn-extensions';
import { servicesOf, type DiagramElement, type ModdleElement } from './bpmn-types';
import { ElementPanel, type Change, type PickOption, type Selection } from './element-panel';
import { modelerTexts, problemMessage } from './modeler-texts';

// The process modeler (slice 2.10, ADR-0005 decision 6): bpmn-js on the left of the canvas
// direction-independent (a diagram reads left to right in every locale), the settings of the
// selected element beside it. A designer saves drafts (`process.definitions.design`); a
// publisher publishes the model as the next revision (`process.definitions.publish`, D7). The
// API checks every model; the screen only keeps what it offers within the guard. The bpmn.io
// watermark stays visible (ADR-0009 decision 6): nothing is placed over the canvas.

type BpmnModeler = Modeler;
type Element = DiagramElement;

const TASK_ATTRIBUTES = [
  'phoenixRole',
  'phoenixAssignee',
  'phoenixDue',
  'phoenixDueDays',
  'phoenixEscalationRole',
  'phoenixOutcomes',
] as const;

function selectionOf(modeler: BpmnModeler, element: Element | null, key: string): Selection {
  if (element === null || element.type === 'bpmn:Process' || element.type === 'label') {
    const root = servicesOf(modeler).canvas.getRootElement();
    return { kind: 'process', key, name: root.businessObject.name ?? '' };
  }
  const bo = element.businessObject;
  const name = bo.name ?? '';
  const text = (attribute: string): string | null => {
    const value = bo.get(attribute);
    return typeof value === 'string' && value !== '' ? value : null;
  };
  if (bo.$instanceOf('bpmn:UserTask')) {
    const attributes: TaskAttributes = {};
    for (const attribute of TASK_ATTRIBUTES) {
      const value = text(`phoenix:${attribute}`);
      if (value !== null) attributes[attribute] = value;
    }
    return {
      kind: 'userTask',
      id: bo.id,
      name,
      formKey: text('flowable:formKey'),
      attributes,
    };
  }
  if (bo.$instanceOf('bpmn:StartEvent')) {
    return { kind: 'startEvent', id: bo.id, name, formKey: text('flowable:formKey') };
  }
  const timer = (bo.eventDefinitions ?? []).find((definition: ModdleElement) =>
    definition.$instanceOf('bpmn:TimerEventDefinition'),
  );
  if (timer !== undefined) {
    return { kind: 'timer', id: bo.id, name, duration: timer.timeDuration?.body ?? null };
  }
  if (bo.$instanceOf('bpmn:SequenceFlow')) {
    const source = bo.sourceRef;
    const fromSplit =
      source !== undefined &&
      (source.$instanceOf('bpmn:ExclusiveGateway') || source.$instanceOf('bpmn:InclusiveGateway'));
    return {
      kind: 'flow',
      id: bo.id,
      name,
      fromSplit,
      condition: bo.conditionExpression?.body ?? null,
      isDefault: fromSplit && source.default === bo,
    };
  }
  return { kind: 'other', id: bo.id, name, type: bo.$type };
}

/** Every outcome code the model's user tasks offer, in model order. */
function modelOutcomes(modeler: BpmnModeler): string[] {
  const codes = servicesOf(modeler)
    .elementRegistry.filter((element) => element.businessObject.$instanceOf('bpmn:UserTask'))
    .flatMap((element) => {
      const listed = element.businessObject.get('phoenix:phoenixOutcomes');
      return outcomesOf(typeof listed === 'string' ? listed : undefined);
    });
  return [...new Set(codes)];
}

type Notice = { tone: 'success' | 'critical' | 'warning'; text: string } | null;

export function ProcessModeler(props: {
  readonly t: Messages;
  readonly locale: string;
  readonly csrfToken: string;
  readonly processKey: string;
  readonly initialXml: string;
  /** The draft's version; 0 while the key has no draft. */
  readonly draftVersion: number;
  readonly publishedRevision: number | null;
  readonly canPublish: boolean;
  readonly roles: readonly PickOption[] | null;
  readonly people: readonly PickOption[] | null;
  readonly forms: readonly PickOption[] | null;
}) {
  const { t, locale, csrfToken, processKey } = props;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const selectedRef = useRef<Element | null>(null);
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selection, setSelection] = useState<Selection>({
    kind: 'process',
    key: processKey,
    name: '',
  });
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(props.draftVersion);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const textsRef = useRef(modelerTexts(t));

  const refresh = useCallback(() => {
    const modeler = modelerRef.current;
    if (modeler === null) return;
    setSelection(selectionOf(modeler, selectedRef.current, processKey));
    setOutcomes(modelOutcomes(modeler));
    const stack = servicesOf(modeler).commandStack;
    setCanUndo(stack.canUndo());
    setCanRedo(stack.canRedo());
  }, [processKey]);

  useEffect(() => {
    let disposed = false;
    let modeler: BpmnModeler | null = null;
    void (async () => {
      const { default: BpmnJs } = await import('bpmn-js/lib/Modeler');
      if (disposed || container.current === null) return;
      const created = new BpmnJs({
        container: container.current,
        additionalModules: [PHOENIX_MODELER_MODULE, translateModule(textsRef.current)],
        moddleExtensions: MODDLE_EXTENSIONS,
        // The theme's tokens, so the diagram follows light and dark (set as CSS, not attributes).
        bpmnRenderer: {
          defaultFillColor: 'var(--px-color-surface)',
          defaultStrokeColor: 'var(--px-color-fg)',
          defaultLabelColor: 'var(--px-color-fg)',
        },
      });
      modeler = created;
      modelerRef.current = created;
      try {
        await created.importXML(props.initialXml);
        servicesOf(created).canvas.zoom('fit-viewport', 'auto');
      } catch {
        if (!disposed) setReady('failed');
        return;
      }
      created.on('selection.changed', ({ newSelection }: { newSelection: Element[] }) => {
        selectedRef.current = newSelection.length === 1 ? (newSelection[0] ?? null) : null;
        refresh();
      });
      created.on('commandStack.changed', () => {
        setDirty(true);
        refresh();
      });
      if (!disposed) {
        setReady('ready');
        refresh();
      }
    })();
    return () => {
      disposed = true;
      modeler?.destroy();
      modelerRef.current = null;
    };
    // The model is read once; later changes live in bpmn-js until saved.
  }, []);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function apply(change: Change) {
    const modeler = modelerRef.current;
    if (modeler === null) return;
    const { canvas, modeling, moddle, elementRegistry } = servicesOf(modeler);
    const element: Element = selectedRef.current ?? canvas.getRootElement();
    const bo = element.businessObject;
    switch (change.kind) {
      case 'name':
        if (element === canvas.getRootElement()) {
          modeling.updateModdleProperties(element, bo, { name: change.value || undefined });
        } else {
          modeling.updateProperties(element, { name: change.value || undefined });
        }
        break;
      case 'attributes':
        modeling.updateProperties(
          element,
          Object.fromEntries(
            Object.entries(change.value).map(([name, value]) => [`phoenix:${name}`, value]),
          ),
        );
        break;
      case 'formKey':
        modeling.updateProperties(element, { 'flowable:formKey': change.value ?? undefined });
        break;
      case 'timer': {
        const timer = bo.eventDefinitions?.[0];
        if (timer === undefined) break;
        modeling.updateModdleProperties(element, timer, {
          timeDuration:
            change.value === null
              ? undefined
              : moddle.create('bpmn:FormalExpression', { body: change.value }),
          timeDate: undefined,
          timeCycle: undefined,
        });
        break;
      }
      case 'condition':
        modeling.updateProperties(element, {
          conditionExpression:
            change.value === null
              ? undefined
              : moddle.create('bpmn:FormalExpression', { body: change.value }),
        });
        break;
      case 'default': {
        const source = bo.sourceRef;
        const gateway = source === undefined ? undefined : elementRegistry.get(source.id);
        if (source === undefined || gateway === undefined) break;
        modeling.updateProperties(gateway, {
          default: change.value ? bo : source.default === bo ? undefined : source.default,
        });
        if (change.value) modeling.updateProperties(element, { conditionExpression: undefined });
        break;
      }
    }
  }

  async function currentXml(): Promise<string | null> {
    const modeler = modelerRef.current;
    if (modeler === null) return null;
    const { xml = '' } = await modeler.saveXML({ format: true });
    if (modelBytes(xml) > MAX_REQUEST_MODEL_BYTES) {
      setNotice({ tone: 'critical', text: t['modeler.tooLarge'] });
      return null;
    }
    return xml;
  }

  async function save(): Promise<boolean> {
    setNotice(null);
    const xml = await currentXml();
    if (xml === null) return false;
    setBusy('save');
    const answer = await callApi<{
      version: number;
      problem: { code: string; field?: string } | null;
    }>('PUT', `process/definitions/${processKey}/draft`, csrfToken, { bpmnXml: xml, version });
    setBusy(null);
    if (!answer.ok) {
      setNotice({
        tone: 'critical',
        text:
          answer.code === 'conflict.stale'
            ? t['modeler.stale']
            : (problemMessage(t, answer.code, null) ?? t[failureMessage(answer)]),
      });
      return false;
    }
    setVersion(answer.body.version);
    setDirty(false);
    const { problem } = answer.body;
    setNotice(
      problem === null
        ? { tone: 'success', text: t['modeler.saved'] }
        : {
            tone: 'warning',
            text: `${t['modeler.savedWithProblem']} ${problemMessage(t, problem.code, problem.field ?? null) ?? ''}`,
          },
    );
    return true;
  }

  async function publish() {
    if (dirty && !(await save())) return;
    const xml = await currentXml();
    if (xml === null) return;
    setBusy('publish');
    const answer = await callApi<{ revision: number }>('POST', 'process/revisions', csrfToken, {
      processKey,
      bpmnXml: xml,
    });
    setBusy(null);
    if (answer.ok) {
      setNotice({
        tone: 'success',
        text: fill(t['modeler.published'], {
          revision: formatNumber(answer.body.revision, locale),
        }),
      });
      router.refresh();
    } else {
      setNotice({
        tone: 'critical',
        text: problemMessage(t, answer.code, null) ?? t[failureMessage(answer)],
      });
    }
  }

  async function download() {
    const modeler = modelerRef.current;
    if (modeler === null) return;
    const { xml = '' } = await modeler.saveXML({ format: true });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${processKey}.bpmn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const modeler = modelerRef.current;
    if (file === undefined || modeler === null) return;
    setNotice(null);
    const xml = await file.text();
    try {
      await modeler.importXML(xml);
    } catch {
      setNotice({ tone: 'critical', text: t['modeler.importFailed'] });
      return;
    }
    const root = servicesOf(modeler).canvas.getRootElement();
    if (root.businessObject.id !== processKey) {
      setNotice({
        tone: 'critical',
        text: fill(t['modeler.importOtherKey'], { key: processKey }),
      });
      await modeler.importXML(props.initialXml);
    }
    servicesOf(modeler).canvas.zoom('fit-viewport', 'auto');
    selectedRef.current = null;
    setDirty(true);
    refresh();
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const editor = modelerRef.current;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {version === 0 ? (
            <Badge>{t['modeler.state.new']}</Badge>
          ) : (
            <Badge tone="info">
              {fill(t['modeler.state.draft'], { version: formatNumber(version, locale) })}
            </Badge>
          )}
          {props.publishedRevision === null ? null : (
            <Badge tone="success">
              {fill(t['modeler.state.published'], {
                revision: formatNumber(props.publishedRevision, locale),
              })}
            </Badge>
          )}
          {dirty ? <Badge tone="warning">{t['modeler.state.unsaved']}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t['modeler.undo']}
            title={t['modeler.undo']}
            disabled={!canUndo}
            onClick={() => editor && servicesOf(editor).commandStack.undo()}
          >
            <Undo2 aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t['modeler.redo']}
            title={t['modeler.redo']}
            disabled={!canRedo}
            onClick={() => editor && servicesOf(editor).commandStack.redo()}
          >
            <Redo2 aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t['modeler.fit']}
            title={t['modeler.fit']}
            disabled={ready !== 'ready'}
            onClick={() => editor && servicesOf(editor).canvas.zoom('fit-viewport', 'auto')}
          >
            <Maximize aria-hidden />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".bpmn,.xml,application/xml,text/xml"
            className="hidden"
            onChange={(event) => void importFile(event)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={ready !== 'ready'}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden />
            {t['modeler.import']}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ready !== 'ready'}
            onClick={() => void download()}
          >
            <Download aria-hidden />
            {t['modeler.download']}
          </Button>
          <Button
            variant={props.canPublish ? 'outline' : 'primary'}
            size="sm"
            disabled={ready !== 'ready' || busy !== null || (!dirty && version > 0)}
            onClick={() => void save()}
          >
            <Save aria-hidden />
            {busy === 'save' ? t['common.saving'] : t['modeler.save']}
          </Button>
          {props.canPublish ? (
            <Button
              size="sm"
              disabled={ready !== 'ready' || busy !== null}
              onClick={() => void publish()}
            >
              <Rocket aria-hidden />
              {busy === 'publish' ? t['modeler.publishing'] : t['modeler.publish']}
            </Button>
          ) : null}
        </div>
      </div>
      {notice === null ? null : (
        <Alert tone={notice.tone} role={notice.tone === 'critical' ? 'alert' : 'status'}>
          {notice.text}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="relative overflow-hidden">
          {/* Diagrams read left to right in every locale; the page around them follows the tenant. */}
          <div
            ref={container}
            dir="ltr"
            tabIndex={0}
            aria-label={t['modeler.canvas']}
            className="phoenix-modeler h-[28rem] w-full sm:h-[36rem] lg:h-[calc(100dvh-16rem)] lg:min-h-[32rem]"
          />
          {ready === 'loading' ? (
            <div className="absolute inset-0 space-y-3 bg-surface p-6" aria-busy="true">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : null}
          {ready === 'failed' ? (
            <div className="absolute inset-0 grid place-items-center bg-surface p-6">
              <Alert tone="critical">{t['modeler.loadFailed']}</Alert>
            </div>
          ) : null}
        </Card>
        <Card className="p-4 lg:max-h-[calc(100dvh-16rem)] lg:min-h-[32rem] lg:overflow-y-auto">
          {ready === 'ready' ? (
            <ElementPanel
              t={t}
              selection={selection}
              roles={props.roles}
              people={props.people}
              forms={props.forms}
              outcomes={outcomes}
              onChange={apply}
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
