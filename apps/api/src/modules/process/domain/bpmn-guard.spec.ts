import { checkBpmn, MAX_BPMN_BYTES } from './bpmn-guard';

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

const refusal = (xml: string, key = 'leave-approval') => {
  const result = checkBpmn(xml, key);
  return result.ok ? null : result.error;
};

describe('checkBpmn (slice 2.2 security: only plain BPMN reaches the shared engine)', () => {
  it('accepts a plain approval model with timers, gateways and safe conditions', () => {
    expect(refusal(model(APPROVAL))).toBeNull();
  });

  it.each([
    ['a script task', '<scriptTask id="s" scriptFormat="groovy"><script>x</script></scriptTask>', 'scriptTask'],
    ['a service task', '<serviceTask id="s" flowable:class="com.Evil"/>', 'serviceTask'],
    ['a service task under another prefix', '<x:serviceTask xmlns:x="http://www.omg.org/spec/BPMN/20100524/MODEL" id="s"/>', 'serviceTask'],
    ['a business rule task', '<businessRuleTask id="b"/>', 'businessRuleTask'],
    ['a call activity', '<callActivity id="c" calledElement="other"/>', 'callActivity'],
    ['a sub-process', '<subProcess id="p"/>', 'subProcess'],
    ['a send task', '<sendTask id="s"/>', 'sendTask'],
    ['a task listener', '<userTask id="u"><extensionElements><flowable:taskListener event="create" class="E"/></extensionElements></userTask>', 'extensionElements'],
    ['an assignee', '<userTask id="u" flowable:assignee="kermit"/>', 'assignee'],
    ['candidate groups', '<userTask id="u" flowable:candidateGroups="admins"/>', 'candidateGroups'],
    ['a delegate expression', '<userTask id="u" flowable:delegateExpression="x"/>', 'delegateExpression'],
    ['an async flag', '<userTask id="u" flowable:async="true"/>', 'async'],
    ['a script condition', '<sequenceFlow id="f" sourceRef="a" targetRef="b"><conditionExpression language="groovy">true</conditionExpression></sequenceFlow>', 'language'],
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

  it.each([
    ['a DOCTYPE', '<!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]>'],
    ['a processing instruction', '<?evil run?>'],
  ])('refuses %s', (_label, prefix) => {
    const xml = model(APPROVAL).replace('<definitions', `${prefix}\n<definitions`);
    expect(refusal(xml)).toEqual({ code: 'process.bpmn.forbidden-construct', field: 'declaration' });
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
