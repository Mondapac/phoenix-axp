import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  attributesOf,
  inboxPath,
  isProcessKey,
  MAX_REQUEST_MODEL_BYTES,
  modelBytes,
  outcomeCondition,
  outcomeOfCondition,
  parseDeadline,
  parseTimerDuration,
  settingsOf,
  settingsProblems,
  standingOf,
  starterModel,
  timerDurationOf,
  type InboxTask,
} from './process';

const ROLE = '0190a000-0000-7000-8000-000000000001';
const PERSON = '0190a000-0000-7000-8000-000000000002';

describe('task settings (mirror of modules/process/domain/task-settings.ts)', () => {
  it('reads and writes a role queue with a working-day deadline, escalation and outcomes', () => {
    const attributes = {
      phoenixRole: ROLE,
      phoenixDue: 'P2D',
      phoenixDueDays: 'working',
      phoenixEscalationRole: PERSON,
      phoenixOutcomes: 'approve,reject',
    };
    const settings = settingsOf(attributes);
    expect(settings).toEqual({
      assignment: { kind: 'role', roleId: ROLE },
      deadline: { amount: 2, unit: 'days', count: 'working' },
      escalationRoleId: PERSON,
      outcomes: ['approve', 'reject'],
    });
    expect(settingsProblems(settings)).toEqual([]);
    expect(attributesOf(settings)).toEqual({ ...attributes, phoenixAssignee: undefined });
  });

  it('removes what the other choice set: a person drops the role, no deadline drops escalation', () => {
    const settings = settingsOf({ phoenixRole: ROLE, phoenixEscalationRole: ROLE });
    expect(
      attributesOf({ ...settings, assignment: { kind: 'person', accountId: PERSON } }),
    ).toEqual({
      phoenixRole: undefined,
      phoenixAssignee: PERSON,
      phoenixDue: undefined,
      phoenixDueDays: undefined,
      phoenixEscalationRole: undefined,
      phoenixOutcomes: undefined,
    });
    expect(settingsOf({}).assignment).toEqual({ kind: 'supervisor' });
  });

  it('counts hours on the clock only and bounds the amounts', () => {
    expect(parseDeadline('PT4H', 'working')).toEqual({
      amount: 4,
      unit: 'hours',
      count: 'calendar',
    });
    expect(parseDeadline('P366D', 'calendar')).toBeNull();
    expect(parseDeadline('PT721H', undefined)).toBeNull();
    expect(parseDeadline('tomorrow', undefined)).toBeNull();
    const base = settingsOf({ phoenixRole: ROLE });
    expect(
      settingsProblems({ ...base, deadline: { amount: 0, unit: 'days', count: 'working' } }),
    ).toEqual(['deadline-invalid']);
    expect(
      settingsProblems({ ...base, deadline: { amount: 3, unit: 'hours', count: 'working' } }),
    ).toEqual(['deadline-invalid']);
  });

  it('names what the API would refuse: no role or person, bad, repeated or too many outcomes', () => {
    const base = settingsOf({});
    expect(settingsProblems({ ...base, assignment: { kind: 'role', roleId: null } })).toEqual([
      'role-missing',
    ]);
    expect(
      settingsProblems({ ...base, assignment: { kind: 'person', accountId: 'someone' } }),
    ).toEqual(['person-missing']);
    expect(settingsProblems({ ...base, outcomes: ['Approve'] })).toEqual(['outcome-invalid']);
    expect(settingsProblems({ ...base, outcomes: ['ok', 'ok'] })).toEqual(['outcome-repeated']);
    expect(
      settingsProblems({ ...base, outcomes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }),
    ).toEqual(['outcomes-too-many']);
    const due = { amount: 2, unit: 'days', count: 'calendar' } as const;
    expect(settingsProblems({ ...base, deadline: due, escalationRoleId: 'managers' })).toEqual([
      'escalation-invalid',
    ]);
    expect(settingsProblems({ ...base, deadline: due, escalationRoleId: ROLE })).toEqual([]);
  });
});

describe('what the API takes in one request', () => {
  it('reads the inbox within the API limit (MAX_INBOX_TASKS = 100; more answers 400)', () => {
    expect(inboxPath(false)).toBe('process/tasks?limit=100');
    expect(inboxPath(true)).toBe('process/tasks/supervised?limit=100');
  });

  it('weighs a model as its JSON body, escapes included, under the 64 KiB body limit', () => {
    const quoted = '"\n'.repeat(1000);
    expect(modelBytes(quoted)).toBeGreaterThan(new TextEncoder().encode(quoted).length * 1.5);
    expect(MAX_REQUEST_MODEL_BYTES).toBeLessThan(64 * 1024);
    expect(modelBytes(starterModel('leave', 'Leave', 'Review'))).toBeLessThan(
      MAX_REQUEST_MODEL_BYTES,
    );
  });
});

describe('conditions, timers and keys', () => {
  it('writes an outcome condition the guard accepts and reads it back', () => {
    expect(outcomeCondition('approve')).toBe("${phoenixOutcome == 'approve'}");
    expect(outcomeOfCondition(outcomeCondition('send-back'))).toBe('send-back');
    expect(outcomeOfCondition('${amount > 10}')).toBeNull();
    expect(outcomeOfCondition(undefined)).toBeNull();
  });

  it('writes timer durations of at least a minute', () => {
    expect(timerDurationOf({ amount: 30, unit: 'minutes' })).toBe('PT30M');
    expect(timerDurationOf({ amount: 2, unit: 'hours' })).toBe('PT2H');
    expect(timerDurationOf({ amount: 1, unit: 'days' })).toBe('P1D');
    expect(parseTimerDuration('PT30M')).toEqual({ amount: 30, unit: 'minutes' });
    expect(parseTimerDuration('PT30S')).toBeNull();
    expect(parseTimerDuration('${wait}')).toBeNull();
  });

  it('accepts process keys as the API does', () => {
    expect(isProcessKey('leave-request')).toBe(true);
    expect(isProcessKey('_leave_2')).toBe(true);
    expect(isProcessKey('1leave')).toBe(false);
    expect(isProcessKey('مرخصی')).toBe(false);
    expect(isProcessKey('a'.repeat(65))).toBe(false);
  });

  it('starts a new key from a model of that key, its names escaped', () => {
    const xml = starterModel('leave', 'Leave & <rest>', 'بررسی');
    expect(xml).toContain('<bpmn:process id="leave" name="Leave &amp; &lt;rest&gt;"');
    expect(xml).toContain('xmlns:phoenix="urn:phoenix:bpmn"');
    expect(xml).toContain('name="بررسی"');
    expect(() => starterModel('1 bad', 'x', 'y')).toThrow();
  });
});

describe('a task standing for the reader', () => {
  const task = (patch: Partial<InboxTask>): InboxTask => ({
    id: 'task',
    instanceId: 'instance',
    taskKey: 'review',
    name: null,
    formKey: null,
    formRevisionId: null,
    status: 'open',
    siteId: null,
    queueRoleId: ROLE,
    assigneeAccountId: null,
    dueAt: null,
    overdue: false,
    escalatedAt: null,
    outcomes: [],
    version: 1,
    ...patch,
  });

  it.each([
    [{}, 'queue'],
    [{ assigneeAccountId: PERSON }, 'mine'],
    [{ assigneeAccountId: ROLE }, 'other'],
    [{ queueRoleId: null }, 'unassigned'],
    [{ status: 'completing' as const, assigneeAccountId: PERSON }, 'completing'],
    [{ status: 'completed' as const }, 'closed'],
  ])('%o is %s', (patch, standing) => {
    expect(standingOf(task(patch), PERSON)).toBe(standing);
  });
});

// The bpmn.io licence (ADR-0009 decision 6, CTO condition on bpmn-js): the watermark stays fully
// visible and not overlapped. No studio source may name its element, so none can hide, move or
// restyle it.
describe('the bpmn.io watermark', () => {
  it('is never targeted by the studio', () => {
    const root = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(css|tsx?|mjs)$/.test(name) && !file.endsWith('process.spec.ts'))
          files.push(file);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const naming = files.filter((file) =>
      /powered-by|bjs-powered/i.test(readFileSync(file, 'utf8')),
    );
    expect(naming).toEqual([]);
  });
});
