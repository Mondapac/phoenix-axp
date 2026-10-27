import { Temporal } from '@phoenix/shared-kernel';
import {
  COMMAND_LEASE_MS,
  ENGINE_CALL_TIMEOUT_MS,
  invalidVariable,
  MAX_CALLS_PER_COMMAND,
  retryDelayMs,
} from './engine-command';
import { adoptionOf, endStatusOf } from './instance';
import { canRequestCompletion, statusOnEngineEnd } from './task';
import { advance, queryFrom, WATERMARK_MARGIN_MS } from './watermark';

describe('instance adoption (ADR-0020 decision 9: first writer wins)', () => {
  it('adopts the first instance, keeps it, and calls any other an orphan', () => {
    expect(adoptionOf(null, 'e-1')).toBe('adopt');
    expect(adoptionOf('e-1', 'e-1')).toBe('same');
    expect(adoptionOf('e-1', 'e-2')).toBe('orphan');
  });

  it('ends a deleted instance as cancelled, any other as completed', () => {
    expect(endStatusOf(true)).toBe('cancelled');
    expect(endStatusOf(false)).toBe('completed');
  });
});

describe('statusOnEngineEnd (PoC 3 R4, R7, R10)', () => {
  const open = { status: 'open', completionKey: null } as const;
  const completing = { status: 'completing', completionKey: 'k-1' } as const;

  it('closes the core completion as completed, without an incident', () => {
    expect(statusOnEngineEnd(completing, { kind: 'completed', completionKey: 'k-1' })).toEqual({
      status: 'completed',
      incident: null,
    });
  });

  it('flags a completion without the core key (R10), and one with another key', () => {
    expect(statusOnEngineEnd(open, { kind: 'completed', completionKey: null })).toEqual({
      status: 'completed',
      incident: 'completed-outside-core',
    });
    expect(statusOnEngineEnd(completing, { kind: 'completed', completionKey: 'k-2' })).toEqual({
      status: 'completed',
      incident: 'completed-outside-core',
    });
  });

  it('marks a pending completion superseded when the engine removed the task (deadline won)', () => {
    expect(statusOnEngineEnd(completing, { kind: 'deleted', reason: 'boundary event (t)' })).toEqual(
      { status: 'superseded', incident: 'completion-superseded' },
    );
  });

  it('tells an escalation by a boundary timer from any other removal', () => {
    expect(statusOnEngineEnd(open, { kind: 'deleted', reason: 'boundary event (t1)' })).toEqual({
      status: 'escalated',
      incident: null,
    });
    expect(statusOnEngineEnd(open, { kind: 'deleted', reason: 'operator' })).toEqual({
      status: 'cancelled',
      incident: null,
    });
    expect(statusOnEngineEnd(open, { kind: 'deleted', reason: null })).toEqual({
      status: 'cancelled',
      incident: null,
    });
  });

  it('leaves a closed task alone', () => {
    for (const status of ['completed', 'superseded', 'escalated', 'cancelled'] as const) {
      expect(statusOnEngineEnd({ status, completionKey: null }, { kind: 'deleted', reason: null })).toBeNull();
    }
  });

  it('accepts a completion request for an open task only', () => {
    expect(canRequestCompletion(open)).toBe(true);
    expect(canRequestCompletion(completing)).toBe(false);
  });
});

describe('engine commands (ADR-0020 decision 7)', () => {
  it('holds a lease of at least twice the longest delivery', () => {
    expect(COMMAND_LEASE_MS).toBeGreaterThanOrEqual(
      2 * ENGINE_CALL_TIMEOUT_MS * MAX_CALLS_PER_COMMAND,
    );
  });

  it('backs off from 5 s, doubling, up to 5 minutes', () => {
    expect([1, 2, 3, 7, 30].map(retryDelayMs)).toEqual([5000, 10_000, 20_000, 300_000, 300_000]);
    expect(() => retryDelayMs(0)).toThrow(RangeError);
  });

  it('sends ids, codes, integers and flags only, never the core variables', () => {
    expect(invalidVariable({ outcome: 'approve', days: 3, urgent: true })).toBeNull();
    expect(invalidVariable({ comment: 'free text with spaces' })).toBe('comment');
    expect(invalidVariable({ amount: 1.5 })).toBe('amount');
    expect(invalidVariable({ phoenixInstanceId: 'x' })).toBe('phoenixInstanceId');
    expect(invalidVariable({ 'bad name': 'x' })).toBe('bad name');
    expect(invalidVariable({ nested: { a: 1 } })).toBe('nested');
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`v${i}`, i]));
    expect(invalidVariable(many)).toBe('variables');
  });
});

describe('watermarks (PoC 3 R5)', () => {
  const t = (iso: string) => Temporal.Instant.from(iso);

  it('reads the whole history first, then from the watermark minus the margin', () => {
    expect(queryFrom(null)).toBeNull();
    expect(queryFrom(t('2026-10-27T12:00:00Z'))?.epochMilliseconds).toBe(
      t('2026-10-27T12:00:00Z').epochMilliseconds - WATERMARK_MARGIN_MS,
    );
  });

  it('moves to the latest end seen and never back', () => {
    const w = t('2026-10-27T12:00:00Z');
    expect(advance(null, [])).toBeNull();
    expect(advance(w, [t('2026-10-27T11:00:00Z')])).toBe(w);
    expect(advance(w, [t('2026-10-27T12:00:05Z'), t('2026-10-27T12:00:01Z')])?.toString()).toBe(
      '2026-10-27T12:00:05Z',
    );
  });
});
