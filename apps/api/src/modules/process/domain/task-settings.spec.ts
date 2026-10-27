import { attributesOf, outcomeAccepted, outcomeOf, parseTaskSettings } from './task-settings';

// The modeller's settings of a user task (ADR-0025; owner decisions D3 and D4).

const ROLE = '01990000-0000-7000-8000-000000000001';
const MANAGER = '01990000-0000-7000-8000-000000000002';
const ACCOUNT = '01990000-0000-7000-8000-000000000003';

const parse = (attributes: Record<string, string>) =>
  parseTaskSettings(new Map(Object.entries(attributes)));

describe('parseTaskSettings', () => {
  it('reads a queued task with a working-day deadline, an escalation and outcomes', () => {
    expect(
      parse({
        name: '  بررسی  ',
        phoenixRole: ROLE,
        phoenixDue: 'P2D',
        phoenixDueDays: 'working',
        phoenixEscalationRole: MANAGER,
        phoenixOutcomes: 'approve, reject',
      }),
    ).toEqual({
      ok: true,
      value: {
        name: 'بررسی',
        candidateRoleId: ROLE,
        assigneeAccountId: null,
        deadline: { amount: 2, unit: 'days', count: 'working' },
        escalationRoleId: MANAGER,
        outcomes: ['approve', 'reject'],
      },
    });
  });

  it('reads a task sent to one person, and a task with nothing set', () => {
    expect(parse({ phoenixAssignee: ACCOUNT })).toMatchObject({
      ok: true,
      value: { assigneeAccountId: ACCOUNT, candidateRoleId: null },
    });
    expect(parse({})).toMatchObject({
      ok: true,
      value: { name: null, candidateRoleId: null, deadline: null, outcomes: [] },
    });
  });

  it.each([
    [{ phoenixRole: ROLE, phoenixAssignee: ACCOUNT }, 'phoenixAssignee'],
    [{ phoenixRole: 'admins' }, 'phoenixRole'],
    [{ phoenixAssignee: '42' }, 'phoenixAssignee'],
    [{ phoenixDue: 'tomorrow' }, 'phoenixDue'],
    [{ phoenixDueDays: 'working' }, 'phoenixDueDays'],
    [{ phoenixDue: 'P1D', phoenixDueDays: 'lunar' }, 'phoenixDueDays'],
    [{ phoenixEscalationRole: MANAGER }, 'phoenixEscalationRole'],
    [{ phoenixDue: 'P1D', phoenixEscalationRole: 'boss' }, 'phoenixEscalationRole'],
    [{ phoenixOutcomes: 'approve,approve' }, 'phoenixOutcomes'],
    [{ phoenixOutcomes: 'Approve' }, 'phoenixOutcomes'],
    [{ phoenixOutcomes: 'a,b,c,d,e,f,g,h,i' }, 'phoenixOutcomes'],
    [{ name: 'x'.repeat(256) }, 'name'],
  ])('refuses %j naming %s', (attributes, field) => {
    expect(parse(attributes)).toEqual({
      ok: false,
      error: { code: 'process.bpmn.task-setting-invalid', field },
    });
  });

  it('gives the stored attributes back unchanged', () => {
    const attributes = {
      name: 'Approve',
      phoenixRole: ROLE,
      phoenixDue: 'PT4H',
      phoenixDueDays: 'calendar',
      phoenixEscalationRole: MANAGER,
      phoenixOutcomes: 'approve,reject',
    };
    const parsed = parse(attributes);
    if (!parsed.ok) throw new Error('setup');
    expect(attributesOf(parsed.value)).toEqual(attributes);
    expect(parse(attributesOf(parsed.value))).toEqual(parsed);
  });
});

describe('outcomes', () => {
  it('needs one of the offered outcomes, or none when none is offered', () => {
    expect(outcomeAccepted(['approve', 'reject'], 'approve')).toBe(true);
    expect(outcomeAccepted(['approve', 'reject'], 'maybe')).toBe(false);
    expect(outcomeAccepted(['approve'], null)).toBe(false);
    expect(outcomeAccepted([], null)).toBe(true);
    expect(outcomeAccepted([], 'approve')).toBe(false);
  });

  it('reads a stored outcome only when it is a code', () => {
    expect(outcomeOf('approve')).toBe('approve');
    expect(outcomeOf('${x}')).toBeNull();
    expect(outcomeOf(3)).toBeNull();
  });
});
