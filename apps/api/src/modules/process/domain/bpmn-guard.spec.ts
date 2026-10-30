import { checkBpmn, durationSeconds, MAX_BPMN_BYTES } from './bpmn-guard';

const model = (process: string, key = 'leave-approval') => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:flowable="http://flowable.org/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  typeLanguage="http://www.w3.org/2001/XMLSchema" expressionLanguage="http://www.w3.org/1999/XPath"
  targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" name="Leave approval" isExecutable="true">${process}</process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane id="p1" bpmnElement="${key}">
    <bpmndi:BPMNShape id="s1" bpmnElement="start"><dc:Bounds x="0" y="0" width="36" height="36"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;

const APPROVAL = `
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <userTask id="approve" name="Approve" flowable:formKey="leave-decision"/>
    <boundaryEvent id="deadline" attachedToRef="approve" cancelActivity="true">
      <timerEventDefinition><timeDuration>\${escalateAfter}</timeDuration></timerEventDefinition>
    </boundaryEvent>
    <sequenceFlow id="f2" sourceRef="approve" targetRef="decide"/>
    <exclusiveGateway id="decide" default="f4"/>
    <sequenceFlow id="f3" sourceRef="decide" targetRef="end">
      <conditionExpression xsi:type="tFormalExpression"><![CDATA[\${outcome == 'approve' && days <= 10}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f4" sourceRef="decide" targetRef="end">
      <conditionExpression xsi:type="tFormalExpression">\${outcome != &quot;approve&quot;}</conditionExpression>
    </sequenceFlow>
    <!-- a comment with <scriptTask> inside is not an element -->
    <endEvent id="end"/>`;

// A model as the studio modeler (bpmn-js, slice 2.10) writes it: `bpmn:` prefixes, the core's
// settings and the engine's form key as moddle extensions, a condition on the picked outcome,
// a default flow, a timer boundary event and the diagram's marker attribute. The diagram part is
// the modeler's own output; the condition and the timer are written as moddle serialises them.
const STUDIO_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:phoenix="urn:phoenix:bpmn" xmlns:flowable="http://flowable.org/bpmn" id="definitions" targetNamespace="urn:phoenix:bpmn">
  <bpmn:process id="leave-request" name="درخواست مرخصی" isExecutable="true">
    <bpmn:startEvent id="start">
      <bpmn:outgoing>flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="task_1" name="بررسی درخواست" phoenix:phoenixRole="0190a000-0000-7000-8000-000000045078" phoenix:phoenixDue="P2D" phoenix:phoenixDueDays="working" phoenix:phoenixOutcomes="approve,reject" flowable:formKey="manager-review">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_0cd0emz</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="task_1" />
    <bpmn:exclusiveGateway id="Gateway_1sgzmm0" default="Flow_0pgntte">
      <bpmn:incoming>Flow_0cd0emz</bpmn:incoming>
      <bpmn:outgoing>Flow_187sgwq</bpmn:outgoing>
      <bpmn:outgoing>Flow_0pgntte</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_0cd0emz" sourceRef="task_1" targetRef="Gateway_1sgzmm0" />
    <bpmn:endEvent id="Event_0hzqedt">
      <bpmn:incoming>Flow_187sgwq</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_187sgwq" sourceRef="Gateway_1sgzmm0" targetRef="Event_0hzqedt">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${phoenixOutcome == 'approve'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:userTask id="Activity_1gyii8y" phoenix:phoenixAssignee="0190a000-0000-7000-8000-000000045079">
      <bpmn:incoming>Flow_0pgntte</bpmn:incoming>
      <bpmn:outgoing>Flow_1ebdn8v</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_0pgntte" sourceRef="Gateway_1sgzmm0" targetRef="Activity_1gyii8y" />
    <bpmn:endEvent id="Event_0b3uq1b">
      <bpmn:incoming>Flow_1ebdn8v</bpmn:incoming>
      <bpmn:incoming>Flow_1t0q2m4</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1ebdn8v" sourceRef="Activity_1gyii8y" targetRef="Event_0b3uq1b" />
    <bpmn:boundaryEvent id="Event_1k3w9ze" attachedToRef="Activity_1gyii8y">
      <bpmn:outgoing>Flow_1t0q2m4</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TimerEventDefinition_0x1yq2v">
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT4H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_1t0q2m4" sourceRef="Event_1k3w9ze" targetRef="Event_0b3uq1b" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="diagram">
    <bpmndi:BPMNPlane id="plane" bpmnElement="leave-request">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1sgzmm0_di" bpmnElement="Gateway_1sgzmm0" isMarkerVisible="true">
        <dc:Bounds x="395" y="95" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_0pgntte_di" bpmnElement="Flow_0pgntte">
        <di:waypoint x="420" y="145" />
        <di:waypoint x="420" y="230" />
        <di:waypoint x="510" y="230" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const refusal = (xml: string, key = 'leave-approval') => {
  const result = checkBpmn(xml, key);
  return result.ok ? null : result.error;
};

describe('checkBpmn (slice 2.2 security: only plain BPMN reaches the shared engine)', () => {
  it('accepts a model as the studio modeler writes it', () => {
    expect(refusal(STUDIO_MODEL, 'leave-request')).toBeNull();
  });

  it('accepts a plain approval model with timers, gateways and safe conditions', () => {
    expect(refusal(model(APPROVAL))).toBeNull();
  });

  it.each([
    [
      'a script task',
      '<scriptTask id="s" scriptFormat="groovy"><script>x</script></scriptTask>',
      'scriptTask',
    ],
    ['a service task', '<serviceTask id="s" flowable:class="com.Evil"/>', 'serviceTask'],
    [
      'a service task under another prefix',
      '<x:serviceTask xmlns:x="http://www.omg.org/spec/BPMN/20100524/MODEL" id="s"/>',
      'serviceTask',
    ],
    ['a business rule task', '<businessRuleTask id="b"/>', 'businessRuleTask'],
    ['a call activity', '<callActivity id="c" calledElement="other"/>', 'callActivity'],
    ['a sub-process', '<subProcess id="p"/>', 'subProcess'],
    ['a send task', '<sendTask id="s"/>', 'sendTask'],
    [
      'a task listener',
      '<userTask id="u"><extensionElements><flowable:taskListener event="create" class="E"/></extensionElements></userTask>',
      'extensionElements',
    ],
    ['an assignee', '<userTask id="u" flowable:assignee="kermit"/>', 'assignee'],
    ['candidate groups', '<userTask id="u" flowable:candidateGroups="admins"/>', 'candidateGroups'],
    [
      'a delegate expression',
      '<userTask id="u" flowable:delegateExpression="x"/>',
      'delegateExpression',
    ],
    ['an async flag', '<userTask id="u" flowable:async="true"/>', 'async'],
    [
      'a script condition',
      '<sequenceFlow id="f" sourceRef="a" targetRef="b"><conditionExpression language="groovy">true</conditionExpression></sequenceFlow>',
      'language',
    ],
  ])('refuses %s', (_label, body, field) => {
    expect(refusal(model(body))).toEqual({ code: 'process.bpmn.forbidden-construct', field });
  });

  it.each([
    ['a method call', '${execution.getEngineServices()}'],
    ['a bean call', '${runtimeService.deleteProcessInstance(x, y)}'],
    ['an index', "${x['a']}"],
    ['a function', '${fn:x()}'],
    ['an assignment', '${a = 1}'],
    ['a lambda', '${(x) -> x}'],
    ['a composite text', 'P ${x}'],
    ['a deferred expression', '#{bean.run()}'],
    ['a nested expression in a string', "${a == '${b.c()}'}"],
    ['an expression written with character references', '&#36;{execution.getId()}'],
    ['an expression written with hex references', '&#x24;&#x7B;bean.run()&#x7D;'],
  ])('refuses %s in a value', (_label, expression) => {
    const body = `<startEvent id="start" name="${expression.replace(/"/g, '&quot;')}"/>`;
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });

  it('refuses an unsafe expression in CDATA', () => {
    const body = `<sequenceFlow id="f" sourceRef="a" targetRef="b"><conditionExpression><![CDATA[\${a.b()}]]></conditionExpression></sequenceFlow>`;
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });

  // Security review of slice 2.2, C1: the engine reads an element's text with text and CDATA
  // joined and comments dropped, so the check judges that joined text, never one run.
  it.each([
    ['split by CDATA', '$<![CDATA[{execution.getEngineServices()}]]>'],
    ['split by a comment', '$<!-- -->{execution.getEngineServices()}'],
    ['split across two CDATA sections', '<![CDATA[$]]><![CDATA[{bean.run()}]]>'],
    ['split by a character reference and CDATA', '&#36;<![CDATA[{bean.run()}]]>'],
    ['a safe expression with a call appended in CDATA', '${a}<![CDATA[${b.c()}]]>'],
  ])('refuses an expression %s', (_label, text) => {
    const body = `<startEvent id="start"/><sequenceFlow id="f" sourceRef="start" targetRef="end"><conditionExpression xsi:type="tFormalExpression">${text}</conditionExpression></sequenceFlow><endEvent id="end"/>`;
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });

  it('refuses a child element inside an expression', () => {
    const body = `<startEvent id="start"/><sequenceFlow id="f" sourceRef="start" targetRef="end"><conditionExpression><documentation>$</documentation>{a.b()}</conditionExpression></sequenceFlow><endEvent id="end"/>`;
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'documentation',
    });
  });

  it.each([
    ['an engine object', '${execution}'],
    ['the host environment', '${systemEnvironment}'],
    ['the engine configuration', '${processEngineConfiguration == null}'],
  ])('refuses %s in a condition (M2)', (_label, text) => {
    const body = `<startEvent id="start"/><sequenceFlow id="f" sourceRef="start" targetRef="end"><conditionExpression xsi:type="tFormalExpression">${text}</conditionExpression></sequenceFlow><endEvent id="end"/>`;
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });

  it.each([
    ['a task name', '<userTask id="u" name="${requester}"/>'],
    ['a form key', '<userTask id="u" flowable:formKey="${formOf}"/>'],
    ['documentation', '<documentation>${x}</documentation>'],
  ])('refuses any expression in %s, where the engine would store its text (M2)', (_l, body) => {
    expect(refusal(model(body))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });

  it.each([
    ['an id too long for the core', `<userTask id="${'u'.repeat(65)}"/>`, 'id'],
    ['an id with other characters', '<userTask id="a b"/>', 'id'],
    ['a form key too long', `<userTask id="u" flowable:formKey="${'f'.repeat(129)}"/>`, 'formKey'],
    [
      'a repeating timer',
      '<timerEventDefinition><timeCycle>R/PT1S</timeCycle></timerEventDefinition>',
      'timeCycle',
    ],
  ])('refuses %s (L2, M1)', (_label, body, field) => {
    expect(refusal(model(body))).toEqual({ code: 'process.bpmn.forbidden-construct', field });
  });

  describe('form references (slice 2.6)', () => {
    const checked = (body: string) => {
      const result = checkBpmn(model(body), 'leave-approval');
      if (!result.ok) throw new Error(result.error.code);
      return result.value.forms;
    };

    it('reads the start form and each user task form, with their elements', () => {
      const body = `<startEvent id="start" flowable:formKey="leave-request"/>
        <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
        <userTask id="approve" flowable:formKey="leave-decision"/>
        <sequenceFlow id="f2" sourceRef="approve" targetRef="file"/>
        <userTask id="file"/>
        <sequenceFlow id="f3" sourceRef="file" targetRef="end"/><endEvent id="end"/>`;
      expect(checked(body)).toEqual([
        { elementId: 'start', kind: 'start', formKey: 'leave-request' },
        { elementId: 'approve', kind: 'task', formKey: 'leave-decision' },
      ]);
    });

    it('reads no forms from a model that names none', () => {
      expect(checked('<startEvent id="start"/>')).toEqual([]);
    });

    it.each([
      ['on a manual task', '<manualTask id="m" flowable:formKey="f"/>'],
      [
        'on two start events',
        '<startEvent id="a" flowable:formKey="f"/><startEvent id="b" flowable:formKey="g"/>',
      ],
      ['without a namespace, which the engine ignores', '<userTask id="u" formKey="f"/>'],
      [
        'in a process that does not run',
        '<startEvent id="start"/></process><process id="other" isExecutable="false"><startEvent id="s2" flowable:formKey="f"/>',
      ],
    ])('refuses a form key %s', (_label, body) => {
      expect(refusal(model(body))).toEqual({
        code: 'process.bpmn.forbidden-construct',
        field: 'formKey',
      });
    });
  });

  describe('timer durations (2.2 condition: a minimum)', () => {
    const timer = (duration: string) => `<startEvent id="start"/>
      <sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
      <intermediateCatchEvent id="wait"><timerEventDefinition><timeDuration>${duration}</timeDuration></timerEventDefinition></intermediateCatchEvent>
      <sequenceFlow id="f2" sourceRef="wait" targetRef="end"/><endEvent id="end"/>`;

    it.each(['PT1M', 'PT60S', ' P1D ', 'P1W', 'PT1H30M', '${escalateAfter}', '${ dueIn }'])(
      'accepts %s',
      (duration) => {
        expect(refusal(model(timer(duration)))).toBeNull();
      },
    );

    it.each([
      'PT0S',
      'PT59S',
      'PT59.9S',
      'P',
      'PT',
      '-PT5M',
      '1 hour',
      '${a + b}',
      '${escalateAfter}x',
    ])('refuses %s', (duration) => {
      expect(refusal(model(timer(duration)))).toEqual({
        code: 'process.bpmn.forbidden-construct',
        field: 'timeDuration',
      });
    });

    it('reads the fewest seconds of a duration', () => {
      expect(durationSeconds('P1M')).toBe(28 * 86_400);
      expect(durationSeconds('PT1M30.5S')).toBe(90.5);
      expect(durationSeconds('PT1,5S')).toBe(1.5);
      expect(durationSeconds('P1DT')).toBeNull();
      expect(durationSeconds('nope')).toBeNull();
    });
  });

  it.each([
    ['UTF-7', '<?xml version="1.0" encoding="UTF-7"?>'],
    ['IBM037', '<?xml version="1.0" encoding="IBM037"?>'],
    ['XML 1.1', '<?xml version="1.1"?>'],
  ])('refuses an XML declaration naming %s (L1)', (_label, declaration) => {
    const xml = model(APPROVAL).replace('<?xml version="1.0" encoding="UTF-8"?>', declaration);
    expect(refusal(xml)).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'declaration',
    });
  });

  it('accepts a declaration without an encoding, and none at all', () => {
    const declared = model(APPROVAL);
    expect(refusal(declared.replace(' encoding="UTF-8"', ''))).toBeNull();
    expect(refusal(declared.replace('<?xml version="1.0" encoding="UTF-8"?>\n', ''))).toBeNull();
  });

  describe('a flow the shared engine cannot spin in (M1)', () => {
    it('refuses a loop through a gateway alone', () => {
      const body = `<startEvent id="start"/><sequenceFlow id="f1" sourceRef="start" targetRef="g"/>
        <exclusiveGateway id="g" default="back"/><sequenceFlow id="back" sourceRef="g" targetRef="g"/>`;
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });

    it('refuses a loop through a timer and a manual task, without a person', () => {
      const body = `<startEvent id="start"/><sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
        <intermediateCatchEvent id="wait"><timerEventDefinition><timeDuration>PT5M</timeDuration></timerEventDefinition></intermediateCatchEvent>
        <sequenceFlow id="f2" sourceRef="wait" targetRef="m"/><manualTask id="m"/>
        <sequenceFlow id="f3" sourceRef="m" targetRef="wait"/>`;
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });

    it('accepts a loop back to a user task (a rework step)', () => {
      const body = `${APPROVAL}<sequenceFlow id="rework" sourceRef="decide" targetRef="approve"/>`;
      expect(refusal(model(body))).toBeNull();
    });

    it('refuses a timer start event: only the core starts instances (re-review H1)', () => {
      const body = `<startEvent id="start"><timerEventDefinition><timeDate>2020-01-01T00:00:00Z</timeDate></timerEventDefinition></startEvent>
        <sequenceFlow id="f1" sourceRef="start" targetRef="end"/><endEvent id="end"/>`;
      expect(refusal(model(body))).toEqual({
        code: 'process.bpmn.forbidden-construct',
        field: 'startEvent',
      });
    });

    it('refuses a token pump through a boundary timer back into its own task (re-review H1)', () => {
      const body = `<startEvent id="start"/><sequenceFlow id="f1" sourceRef="start" targetRef="u"/>
        <userTask id="u"/>
        <boundaryEvent id="b" attachedToRef="u" cancelActivity="false"><timerEventDefinition><timeDuration>PT5M</timeDuration></timerEventDefinition></boundaryEvent>
        <sequenceFlow id="f2" sourceRef="b" targetRef="split"/><parallelGateway id="split"/>
        <sequenceFlow id="f3" sourceRef="split" targetRef="u"/><sequenceFlow id="f4" sourceRef="split" targetRef="u"/>`;
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });

    it('refuses parallel splits that multiply tokens without a loop (2.2 condition)', () => {
      // Four splits of eight in a row: 8^4 = 4096 tokens reach the last node.
      const stage = (i: number) =>
        `<parallelGateway id="p${i}"/>` +
        Array.from(
          { length: 8 },
          (_, b) => `<sequenceFlow id="s${i}_${b}" sourceRef="p${i}" targetRef="j${i}"/>`,
        ).join('') +
        `<exclusiveGateway id="j${i}"/><sequenceFlow id="n${i}" sourceRef="j${i}" targetRef="${i === 3 ? 'end' : `p${i + 1}`}"/>`;
      const body = `<startEvent id="start"/><sequenceFlow id="f0" sourceRef="start" targetRef="p0"/>
        ${[0, 1, 2, 3].map(stage).join('')}<endEvent id="end"/>`;
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });

    it('accepts a wide split that joins once, and splits separated by a user task', () => {
      const branches = (from: string, to: string, n: number) =>
        Array.from(
          { length: n },
          (_, b) => `<sequenceFlow id="${from}_${b}" sourceRef="${from}" targetRef="${to}"/>`,
        ).join('');
      const body = `<startEvent id="start"/><sequenceFlow id="f0" sourceRef="start" targetRef="a"/>
        <parallelGateway id="a"/>${branches('a', 'ja', 30)}<parallelGateway id="ja"/>
        <sequenceFlow id="f1" sourceRef="ja" targetRef="u"/><userTask id="u"/>
        <sequenceFlow id="f2" sourceRef="u" targetRef="b"/>
        <parallelGateway id="b"/>${branches('b', 'jb', 30)}<parallelGateway id="jb"/>
        <sequenceFlow id="f3" sourceRef="jb" targetRef="end"/><endEvent id="end"/>`;
      expect(refusal(model(body))).toBeNull();
    });

    it('refuses a flow that names a node the model does not hold', () => {
      const body = `<startEvent id="start"/><sequenceFlow id="f1" sourceRef="start" targetRef="nowhere"/>`;
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });

    it('refuses more flow nodes than the engine is offered', () => {
      const body = Array.from({ length: 501 }, (_, i) => `<manualTask id="m${i}"/>`).join('');
      expect(refusal(model(body))).toEqual({ code: 'process.bpmn.unbounded-flow' });
    });
  });

  it.each([
    ['a DOCTYPE', '<!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]>'],
    ['a processing instruction', '<?evil run?>'],
  ])('refuses %s', (_label, prefix) => {
    const xml = model(APPROVAL).replace('<definitions', `${prefix}\n<definitions`);
    expect(refusal(xml)).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'declaration',
    });
  });

  it('refuses another expression or type language', () => {
    const xml = model(APPROVAL).replace(
      'expressionLanguage="http://www.w3.org/1999/XPath"',
      'expressionLanguage="javascript"',
    );
    expect(refusal(xml)).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expressionLanguage',
    });
  });

  it.each([
    ['an unclosed element', model(APPROVAL).replace('</definitions>', '')],
    ['a mismatched end tag', model(APPROVAL).replace('</process>', '</proces>')],
    ['an undefined entity', model('<startEvent id="s" name="&nbsp;"/>')],
    ['a bare ampersand', model('<startEvent id="s" name="a & b"/>')],
    ['two roots', `${model(APPROVAL)}<definitions/>`],
    ['text outside the root', `${model(APPROVAL)} trailing`],
    ['a duplicate attribute', model('<startEvent id="s" id="t"/>')],
    ['an unquoted attribute', model('<startEvent id=s/>')],
    ['empty input', ''],
  ])('refuses %s as malformed', (_label, xml) => {
    expect(refusal(xml)).toEqual({ code: 'process.bpmn.malformed' });
  });

  it('requires one executable process whose id is the process key', () => {
    expect(refusal(model(APPROVAL), 'other-key')).toEqual({
      code: 'process.bpmn.process-key-mismatch',
    });
    expect(refusal(model(APPROVAL).replace('isExecutable="true"', 'isExecutable="false"'))).toEqual(
      { code: 'process.bpmn.process-key-mismatch' },
    );
    expect(refusal(model(APPROVAL), 'bad key')).toEqual({
      code: 'process.bpmn.process-key-mismatch',
    });
  });

  it('refuses a model over the size limit', () => {
    const padding = `<documentation>${'a'.repeat(MAX_BPMN_BYTES)}</documentation>`;
    expect(refusal(model(padding))).toEqual({ code: 'process.bpmn.too-large' });
  });
});

describe('checkBpmn and the core user task settings (slice 2.3, ADR-0025)', () => {
  const ROLE = '01990000-0000-7000-8000-000000000001';
  const settings = (attributes: string, element = 'userTask') => `
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <${element} id="approve" name="Approve" ${attributes}/>
    <sequenceFlow id="f2" sourceRef="approve" targetRef="end"/>
    <endEvent id="end"/>`;

  it('returns each user task with its settings, under any namespace prefix', () => {
    const result = checkBpmn(
      model(settings(`xmlns:p="urn:phoenix" p:phoenixRole="${ROLE}" p:phoenixDue="P2D"`)),
      'leave-approval',
    );
    expect(result.ok && result.value.userTasks.get('approve')).toMatchObject({
      name: 'Approve',
      candidateRoleId: ROLE,
      deadline: { amount: 2, unit: 'days', count: 'calendar' },
    });
  });

  it('refuses a setting on any element but a user task', () => {
    expect(refusal(model(settings(`phoenixRole="${ROLE}"`, 'manualTask')))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'phoenixRole',
    });
  });

  it('refuses an invalid setting, naming the attribute only', () => {
    expect(
      refusal(model(settings('xmlns:p="urn:phoenix" p:phoenixDue="P2D" p:phoenixDueDays="lunar"'))),
    ).toEqual({
      code: 'process.bpmn.task-setting-invalid',
      field: 'phoenixDueDays',
    });
  });

  it('refuses a setting outside a namespace of its own, which the engine would refuse', () => {
    expect(refusal(model(settings(`phoenixRole="${ROLE}"`)))).toEqual({
      code: 'process.bpmn.task-setting-invalid',
      field: 'phoenixRole',
    });
  });

  it('refuses an expression in a setting', () => {
    expect(refusal(model(settings('phoenixRole="${role}"')))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'expression',
    });
  });
});

describe('checkBpmn: decision tasks (slice 2.7)', () => {
  const field = (name: string, value: string) =>
    `<flowable:field name="${name}"><flowable:string>${value}</flowable:string></flowable:field>`;
  const decisionTask = (extension: string, attributes = 'flowable:type="dmn"') => `
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="rate"/>
    <serviceTask id="rate" name="Rate" ${attributes}>
      <extensionElements>${extension}</extensionElements>
    </serviceTask>
    <sequenceFlow id="f2" sourceRef="rate" targetRef="approve"/>
    <userTask id="approve"/>
    <sequenceFlow id="f3" sourceRef="approve" targetRef="end"/>
    <endEvent id="end"/>`;
  const KEY_FIELD = field('decisionTableReferenceKey', 'leave-route');

  it('accepts a decision task naming a table, and reports where it runs it', () => {
    const result = checkBpmn(
      model(decisionTask(KEY_FIELD + field('decisionTaskThrowErrorOnNoHits', 'true'))),
      'leave-approval',
    );
    expect(result.ok && result.value.decisions).toEqual([
      { elementId: 'rate', decisionKey: 'leave-route' },
    ]);
  });

  it('accepts the key as CDATA, as modelers write it', () => {
    const cdata = field('decisionTableReferenceKey', '<![CDATA[leave-route]]>');
    expect(refusal(model(decisionTask(cdata)))).toBeNull();
  });

  it.each([
    ['another service task type', decisionTask(KEY_FIELD, 'flowable:type="http"'), 'serviceTask'],
    ['an unprefixed type the engine ignores', decisionTask(KEY_FIELD, 'type="dmn"'), 'serviceTask'],
    [
      'a class next to the type',
      decisionTask(KEY_FIELD, 'flowable:type="dmn" flowable:class="com.Evil"'),
      'class',
    ],
    [
      'async execution',
      decisionTask(KEY_FIELD, 'flowable:type="dmn" flowable:async="true"'),
      'async',
    ],
    ['no table key', decisionTask(''), 'decisionTableReferenceKey'],
    [
      'an expression as the key',
      decisionTask(field('decisionTableReferenceKey', '${tableKey}')),
      'expression',
    ],
    [
      'a key that is not a decision key',
      decisionTask(field('decisionTableReferenceKey', 'a b')),
      'decisionTableReferenceKey',
    ],
    [
      'the fallback to the default tenant',
      decisionTask(KEY_FIELD + field('fallbackToDefaultTenant', 'true')),
      'field',
    ],
    [
      'a same-deployment lookup',
      decisionTask(KEY_FIELD + field('sameDeployment', 'true')),
      'field',
    ],
    [
      'an expression field',
      decisionTask(
        '<flowable:field name="decisionTableReferenceKey"><flowable:expression>x</flowable:expression></flowable:field>',
      ),
      'expression',
    ],
    [
      'a string value attribute',
      decisionTask('<flowable:field name="decisionTableReferenceKey" stringValue="leave-route"/>'),
      'stringValue',
    ],
    [
      'a flag that is not true or false',
      decisionTask(KEY_FIELD + field('decisionTaskThrowErrorOnNoHits', 'yes')),
      'decisionTaskThrowErrorOnNoHits',
    ],
    [
      'a listener in its extension elements',
      decisionTask(KEY_FIELD + '<flowable:executionListener event="start" class="com.Evil"/>'),
      'executionListener',
    ],
    [
      'extension elements on a user task',
      `<startEvent id="start"/><userTask id="u"><extensionElements>${KEY_FIELD}</extensionElements></userTask>`,
      'extensionElements',
    ],
    ['a field outside a decision task', `<startEvent id="start"/>${KEY_FIELD}`, 'field'],
  ])('refuses %s', (_label, process, field) => {
    expect(refusal(model(process))).toEqual({ code: 'process.bpmn.forbidden-construct', field });
  });

  it('refuses a key in the core variable prefix (L3)', () => {
    expect(
      refusal(model(decisionTask(field('decisionTableReferenceKey', 'phoenixOutcome')))),
    ).toEqual({ code: 'process.bpmn.forbidden-construct', field: 'decisionTableReferenceKey' });
  });

  it('refuses more decision tables than a deployment may carry', () => {
    const tasks = Array.from(
      { length: 6 },
      (_, n) =>
        `<sequenceFlow id="g${n}" sourceRef="${n === 0 ? 'start' : `t${n - 1}`}" targetRef="t${n}"/>` +
        `<serviceTask id="t${n}" flowable:type="dmn"><extensionElements>${field('decisionTableReferenceKey', `table${n}`)}</extensionElements></serviceTask>`,
    ).join('');
    expect(refusal(model(`<startEvent id="start"/>${tasks}`))).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'serviceTask',
    });
  });

  it('refuses a field set twice', () => {
    expect(refusal(model(decisionTask(KEY_FIELD + KEY_FIELD)))).toEqual({
      code: 'process.bpmn.malformed',
    });
  });

  it('refuses a decision task in a process the engine does not run', () => {
    const xml = model(`<startEvent id="start"/>`).replace(
      '</process>',
      `</process><process id="other" isExecutable="false"><serviceTask id="r" flowable:type="dmn"><extensionElements>${KEY_FIELD}</extensionElements></serviceTask></process>`,
    );
    expect(refusal(xml)).toEqual({
      code: 'process.bpmn.forbidden-construct',
      field: 'serviceTask',
    });
  });

  it('refuses a loop through decision tasks that no person breaks', () => {
    const loop = `
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="rate"/>
    <serviceTask id="rate" flowable:type="dmn"><extensionElements>${KEY_FIELD}</extensionElements></serviceTask>
    <sequenceFlow id="f2" sourceRef="rate" targetRef="again"/>
    <exclusiveGateway id="again"/>
    <sequenceFlow id="f3" sourceRef="again" targetRef="rate"/>
    <sequenceFlow id="f4" sourceRef="again" targetRef="end"/>
    <endEvent id="end"/>`;
    expect(refusal(model(loop))).toEqual({ code: 'process.bpmn.unbounded-flow' });
  });
});
