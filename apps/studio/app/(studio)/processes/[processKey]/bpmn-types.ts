import type Modeler from 'bpmn-js/lib/Modeler';

// The few bpmn-js services and model shapes the modeler uses, typed by what it reads of them
// (bpmn-js resolves its services by name, untyped).

export interface ModdleElement {
  readonly $type: string;
  readonly id: string;
  readonly name?: string;
  $instanceOf(type: string): boolean;
  get(name: string): unknown;
  readonly eventDefinitions?: readonly ModdleElement[];
  readonly timeDuration?: { readonly body?: string };
  readonly conditionExpression?: { readonly body?: string };
  readonly sourceRef?: ModdleElement;
  readonly default?: ModdleElement;
}

export interface DiagramElement {
  readonly id: string;
  readonly type: string;
  readonly businessObject: ModdleElement;
}

export interface ModelerServices {
  readonly canvas: {
    getRootElement(): DiagramElement;
    zoom(level: 'fit-viewport', center: 'auto'): void;
  };
  readonly commandStack: {
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
  };
  readonly modeling: {
    updateProperties(element: DiagramElement, properties: Record<string, unknown>): void;
    updateModdleProperties(
      element: DiagramElement,
      target: ModdleElement,
      properties: Record<string, unknown>,
    ): void;
  };
  readonly moddle: { create(type: string, attributes: Record<string, unknown>): ModdleElement };
  readonly elementRegistry: {
    get(id: string): DiagramElement | undefined;
    filter(match: (element: DiagramElement) => boolean): DiagramElement[];
  };
}

/** The modeler's services by name. */
export function servicesOf(modeler: Modeler): ModelerServices {
  return {
    canvas: modeler.get<ModelerServices['canvas']>('canvas'),
    commandStack: modeler.get<ModelerServices['commandStack']>('commandStack'),
    modeling: modeler.get<ModelerServices['modeling']>('modeling'),
    moddle: modeler.get<ModelerServices['moddle']>('moddle'),
    elementRegistry: modeler.get<ModelerServices['elementRegistry']>('elementRegistry'),
  };
}
