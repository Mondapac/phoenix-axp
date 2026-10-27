import { checkCompletion, statusOnEngineEnd, type TaskState } from './task';
import { adoptInstance, finalStatus } from './request';

const open: TaskState = { status: 'open', assigneeId: 'a', completionKey: null };
const completing: TaskState = { status: 'completing', assigneeId: 'a', completionKey: 'k1' };

describe('task state (PoC 3)', () => {
  it('lets only the assignee complete an open task; others get not-found', () => {
    expect(checkCompletion(open, 'a')).toBeNull();
    expect(checkCompletion(open, 'b')).toBe('task.not-found');
    expect(checkCompletion(completing, 'a')).toBe('task.not-open');
  });

  it('closes an open task removed by the boundary timer as escalated', () => {
    expect(
      statusOnEngineEnd(open, { kind: 'deleted', reason: 'boundary event (deadline)' }),
    ).toEqual({ status: 'escalated', incident: null });
    expect(statusOnEngineEnd(open, { kind: 'deleted', reason: 'admin' })).toEqual({
      status: 'cancelled',
      incident: null,
    });
  });

  it('completes a completing task only with its own key; anything else is an incident', () => {
    expect(statusOnEngineEnd(completing, { kind: 'completed', completionKey: 'k1' })).toEqual({
      status: 'completed',
      incident: null,
    });
    expect(statusOnEngineEnd(completing, { kind: 'completed', completionKey: 'k2' })).toEqual({
      status: 'completed',
      incident: 'completed-outside-core',
    });
    expect(statusOnEngineEnd(open, { kind: 'completed', completionKey: null })).toEqual({
      status: 'completed',
      incident: 'completed-outside-core',
    });
  });

  it('supersedes a decision the engine never received because the deadline came first', () => {
    expect(
      statusOnEngineEnd(completing, { kind: 'deleted', reason: 'boundary event (deadline)' }),
    ).toEqual({ status: 'superseded', incident: 'completion-superseded' });
  });

  it('ignores an end for a task already closed (a duplicate observation)', () => {
    expect(
      statusOnEngineEnd({ ...open, status: 'escalated' }, { kind: 'deleted', reason: null }),
    ).toBeNull();
  });

  it('adopts the first instance and calls every other one an orphan', () => {
    expect(adoptInstance(null, 'i1')).toBe('adopted');
    expect(adoptInstance('i1', 'i1')).toBe('already-ours');
    expect(adoptInstance('i1', 'i2')).toBe('orphan');
    expect(finalStatus('approve', false)).toBe('approved');
    expect(finalStatus('reject', false)).toBe('rejected');
    expect(finalStatus(null, true)).toBe('cancelled');
  });
});
