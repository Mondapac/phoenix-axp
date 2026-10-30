import { FLOWABLE_NAMESPACE, PHOENIX_NAMESPACE } from '../../../_lib/process';

// What the studio adds to bpmn-js (ADR-0005 decision 6): the two attribute namespaces the core
// reads, and a palette, context pad and replace menu cut down to the BPMN the core accepts
// (modules/process/domain/bpmn-guard.ts). A shape the guard would refuse cannot be drawn here;
// the API checks every model again anyway. The bpmn.io watermark is bpmn-js's own and is left
// as it is (its licence; ADR-0009 decision 6).

/** The core's user task settings (slice 2.3) and the engine's form key, as moddle extensions. */
export const MODDLE_EXTENSIONS = {
  phoenix: {
    name: 'Phoenix',
    uri: PHOENIX_NAMESPACE,
    prefix: 'phoenix',
    xml: { tagAlias: 'lowerCase' },
    types: [
      {
        name: 'TaskSettings',
        extends: ['bpmn:UserTask'],
        properties: [
          'phoenixRole',
          'phoenixAssignee',
          'phoenixDue',
          'phoenixDueDays',
          'phoenixEscalationRole',
          'phoenixOutcomes',
        ].map((name) => ({ name, isAttr: true, type: 'String' })),
      },
    ],
  },
  flowable: {
    name: 'Flowable',
    uri: FLOWABLE_NAMESPACE,
    prefix: 'flowable',
    xml: { tagAlias: 'lowerCase' },
    types: [
      {
        name: 'FormKey',
        extends: ['bpmn:UserTask', 'bpmn:StartEvent'],
        properties: [{ name: 'formKey', isAttr: true, type: 'String' }],
      },
    ],
  },
} as const;

/** Palette entries of shapes the guard refuses (data, sub-processes, pools, throw events). */
const PALETTE_REFUSED = [
  'create.intermediate-event',
  'create.data-object',
  'create.data-store',
  'create.subprocess-expanded',
  'create.participant-expanded',
];

/** Context pad entries that would append a shape the guard refuses. */
const CONTEXT_PAD_REFUSED = [
  'append.intermediate-event',
  'append.receive-task',
  'append.message-intermediate-event',
  'append.condition-intermediate-event',
  'append.signal-intermediate-event',
  'append.compensation-activity',
];

/** The replace menu offers only these (`replace-with-<id>`). */
const REPLACE_ALLOWED = new Set(
  [
    'user-task',
    'manual-task',
    'exclusive-gateway',
    'parallel-gateway',
    'inclusive-gateway',
    'none-start',
    'none-end',
    'terminate-end',
    'timer-intermediate-catch',
    'timer-boundary',
    'non-interrupting-timer-boundary',
    'sequence-flow',
    'default-flow',
    'conditional-flow',
  ].map((id) => `replace-with-${id}`),
);

type Entries = Record<string, unknown>;
interface Shape {
  readonly type: string;
}
interface ElementFactory {
  createShape(attrs: { type: string }): Shape;
}
interface Create {
  start(event: unknown, shape: Shape, context?: { source: unknown }): void;
}
interface AutoPlace {
  append(source: unknown, shape: Shape): void;
}
type Translate = (text: string, replacements?: Record<string, string>) => string;

const userTaskEntry = (
  elementFactory: ElementFactory,
  create: Create,
  translate: Translate,
  group: string,
) => ({
  group,
  className: 'bpmn-icon-user-task',
  title: translate('Create user task'),
  action: {
    dragstart: (event: unknown) =>
      create.start(event, elementFactory.createShape({ type: 'bpmn:UserTask' })),
    click: (event: unknown) =>
      create.start(event, elementFactory.createShape({ type: 'bpmn:UserTask' })),
  },
});

function PhoenixPalette(
  this: unknown,
  palette: { registerProvider(priority: number, provider: unknown): void },
  create: Create,
  elementFactory: ElementFactory,
  translate: Translate,
) {
  palette.registerProvider(500, {
    getPaletteEntries: () => (entries: Entries) => {
      for (const key of PALETTE_REFUSED) delete entries[key];
      // A plain task runs nothing and the guard refuses it: the palette's task is a user task.
      entries['create.task'] = userTaskEntry(elementFactory, create, translate, 'activity');
      return entries;
    },
  });
}
PhoenixPalette.$inject = ['palette', 'create', 'elementFactory', 'translate'];

function PhoenixContextPad(
  this: unknown,
  contextPad: { registerProvider(priority: number, provider: unknown): void },
  create: Create,
  elementFactory: ElementFactory,
  autoPlace: AutoPlace,
  translate: Translate,
) {
  contextPad.registerProvider(500, {
    getContextPadEntries: () => (entries: Entries) => {
      for (const key of CONTEXT_PAD_REFUSED) delete entries[key];
      if ('append.append-task' in entries) {
        const append = (_: unknown, element: unknown) =>
          autoPlace.append(element, elementFactory.createShape({ type: 'bpmn:UserTask' }));
        entries['append.append-task'] = {
          group: 'model',
          className: 'bpmn-icon-user-task',
          title: translate('Append user task'),
          action: {
            click: append,
            dragstart: (event: unknown, element: unknown) =>
              create.start(event, elementFactory.createShape({ type: 'bpmn:UserTask' }), {
                source: element,
              }),
          },
        };
      }
      return entries;
    },
  });
}
PhoenixContextPad.$inject = ['contextPad', 'create', 'elementFactory', 'autoPlace', 'translate'];

function PhoenixReplaceMenu(
  this: unknown,
  popupMenu: { registerProvider(id: string, priority: number, provider: unknown): void },
) {
  popupMenu.registerProvider('bpmn-replace', 500, {
    getPopupMenuEntries: () => (entries: Entries) =>
      Object.fromEntries(Object.entries(entries).filter(([id]) => REPLACE_ALLOWED.has(id))),
    // Loop and multi-instance markers, ad-hoc and compensation: none of them passes the guard.
    getPopupMenuHeaderEntries: () => () => ({}),
  });
}
PhoenixReplaceMenu.$inject = ['popupMenu'];

/** The studio's bpmn-js module. */
export const PHOENIX_MODELER_MODULE = {
  __init__: ['phoenixPalette', 'phoenixContextPad', 'phoenixReplaceMenu'],
  phoenixPalette: ['type', PhoenixPalette],
  phoenixContextPad: ['type', PhoenixContextPad],
  phoenixReplaceMenu: ['type', PhoenixReplaceMenu],
};

/** bpmn-js's tooltips in the tenant's language: the studio's texts by bpmn-js's English. */
export function translateModule(texts: Readonly<Record<string, string>>) {
  const translate: Translate = (template, replacements) =>
    (texts[template] ?? template).replace(
      /{([^}]+)}/g,
      (_, key: string) => replacements?.[key] ?? `{${key}}`,
    );
  return { translate: ['value', translate] };
}
