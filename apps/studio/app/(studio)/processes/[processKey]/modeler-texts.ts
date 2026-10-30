import { fill, type MessageKey, type Messages } from '../../../_i18n/messages';

// The modeler's texts that are not React: bpmn-js's tooltips by its English, and the reading of
// the API's refusals of a model (codes and an element name, never a value).

/** bpmn-js's English tooltips to the studio's texts (unlisted ones stay in English). */
export function modelerTexts(t: Messages): Record<string, string> {
  return {
    'Activate hand tool': t['bpmn.hand'],
    'Activate lasso tool': t['bpmn.lasso'],
    'Activate create/remove space tool': t['bpmn.space'],
    'Activate global connect tool': t['bpmn.connect'],
    'Create start event': t['bpmn.createStart'],
    'Create end event': t['bpmn.createEnd'],
    'Create gateway': t['bpmn.createGateway'],
    'Create user task': t['bpmn.createUserTask'],
    'Create group': t['bpmn.createGroup'],
    'Append end event': t['bpmn.appendEnd'],
    'Append gateway': t['bpmn.appendGateway'],
    'Append user task': t['bpmn.appendUserTask'],
    'Append text annotation': t['bpmn.appendAnnotation'],
    'Change element': t['bpmn.replace'],
    Delete: t['bpmn.delete'],
    'Connect to other element': t['bpmn.connectTo'],
    'Connect using sequence/message flow or association': t['bpmn.connectTo'],
    'Connect using association': t['bpmn.connectTo'],
    'User task': t['bpmn.userTask'],
    'Manual task': t['bpmn.manualTask'],
    'Exclusive gateway': t['bpmn.exclusiveGateway'],
    'Parallel gateway': t['bpmn.parallelGateway'],
    'Inclusive gateway': t['bpmn.inclusiveGateway'],
    'Start event': t['bpmn.startEvent'],
    'End event': t['bpmn.endEvent'],
    'Terminate end event': t['bpmn.terminateEnd'],
    'Timer intermediate catch event': t['bpmn.timerCatch'],
    'Timer boundary event': t['bpmn.timerBoundary'],
    'Timer boundary event (non-interrupting)': t['bpmn.timerBoundaryNonInterrupting'],
    'Sequence flow': t['bpmn.sequenceFlow'],
    'Default flow': t['bpmn.defaultFlow'],
    'Conditional flow': t['bpmn.conditionalFlow'],
    'Search in diagram': t['bpmn.search'],
  };
}

const BY_CODE: Readonly<Record<string, MessageKey>> = {
  'process.bpmn.too-large': 'modeler.problem.tooLarge',
  'request.body-too-large': 'modeler.tooLarge',
  'process.bpmn.malformed': 'modeler.problem.malformed',
  'process.bpmn.process-key-mismatch': 'modeler.problem.keyMismatch',
  'process.bpmn.unbounded-flow': 'modeler.problem.unbounded',
  'process.bpmn.forbidden-construct': 'modeler.problem.forbidden',
  'process.bpmn.task-setting-invalid': 'modeler.problem.taskSetting',
  'process.form.not-found': 'modeler.problem.formNotFound',
  'process.form.starts-another-process': 'modeler.problem.startsAnother',
  'process.form.start-form-changed': 'modeler.problem.startFormChanged',
};

/** The reading of a model refusal, or null for a code that is not one. */
export function problemMessage(
  t: Messages,
  code: string | null,
  field: string | null,
): string | null {
  if (code === null || !Object.hasOwn(BY_CODE, code)) return null;
  return fill(t[BY_CODE[code]!], { field: field ?? '—' });
}
