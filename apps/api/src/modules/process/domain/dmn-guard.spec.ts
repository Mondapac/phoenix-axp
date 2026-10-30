import { checkDmn, MAX_DMN_BYTES, MAX_DMN_RULES } from './dmn-guard';

const rule = (id: string, inputs: string[], outputs: string[]) =>
  `<rule id="${id}">${inputs.map((text) => `<inputEntry id="${id}i${inputs.indexOf(text)}"><text>${text}</text></inputEntry>`).join('')}${outputs.map((text) => `<outputEntry id="${id}o${outputs.indexOf(text)}"><text>${text}</text></outputEntry>`).join('')}</rule>`;

const table = (
  body: string,
  { key = 'leave-route', hitPolicy = 'FIRST', columns = TWO_INPUTS } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
  xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
  id="defs" name="Leave" namespace="http://phoenix.example/dmn">
  <decision id="${key}" name="Leave route">
    <decisionTable id="t" hitPolicy="${hitPolicy}">
      ${columns}
      ${body}
    </decisionTable>
  </decision>
  <dmndi:DMNDI><dmndi:DMNDiagram id="dd"><dmndi:DMNShape id="ds" dmnElementRef="${key}"><dc:Bounds x="0" y="0" width="180" height="80"/></dmndi:DMNShape></dmndi:DMNDiagram></dmndi:DMNDI>
</definitions>`;

const TWO_INPUTS = `
      <input id="i1" label="Days"><inputExpression id="ie1" typeRef="number"><text>days</text></inputExpression></input>
      <input id="i2" label="Kind"><inputExpression id="ie2" typeRef="string"><text>kind</text></inputExpression></input>
      <output id="o1" name="lane" typeRef="string"/>`;

const RULES = [
  rule('r1', ['&gt; 5', '"sick"'], ['"manager"']),
  rule('r2', ['-', "== 'annual'"], ["'clerk'"]),
  rule('r3', ['&lt;= -1.5', '!= "x"'], ['true']),
  rule('r4', ['', ''], ['42']),
].join('');

const refusal = (xml: string, key = 'leave-route') => {
  const result = checkDmn(xml, key);
  return result.ok ? null : result.error;
};
const forbidden = (field: string) => ({ code: 'process.dmn.forbidden-construct', field });

describe('checkDmn (slice 2.7: only a plain decision table reaches the shared engine)', () => {
  it('accepts a table of literal cells, and reads its inputs and outputs', () => {
    const result = checkDmn(table(RULES), 'leave-route');
    expect(result).toEqual({ ok: true, value: { inputs: ['days', 'kind'], outputs: ['lane'] } });
  });

  it.each([
    ['a method call in an input entry', '.startsWith("a")'],
    ['an expression in an input entry', '${days > 5}'],
    ['a deferred expression', '#{days}'],
    ['a variable as the operand', '&gt; limit'],
    ['free text', '"خیلی زیاد"'],
    ['two comparisons', '&gt; 1 &amp;&amp; &lt; 9'],
    ['a list', '"a","b"'],
  ])('refuses %s', (_label, entry) => {
    expect(refusal(table(rule('r', [entry, '-'], ['"x"'])))).toEqual(forbidden('expression'));
  });

  it.each([
    ['an expression', '${execution.getVariable("a")}'],
    ['a variable', 'kind'],
    ['a comparison', '&gt; 5'],
    ['an empty cell', ''],
  ])('refuses %s as an output', (_label, output) => {
    expect(refusal(table(rule('r', ['-', '-'], [output])))).toEqual(forbidden('expression'));
  });

  it.each([
    ['an engine object', 'execution'],
    ['a member', 'days.class'],
    ['a call', 'days()'],
    ['an expression', '${days}'],
  ])('refuses an input reading %s', (_label, input) => {
    const columns = TWO_INPUTS.replace('<text>days</text>', `<text>${input}</text>`);
    expect(refusal(table(rule('r', ['-', '-'], ['"x"']), { columns }))).toEqual(
      forbidden('expression'),
    );
  });

  it.each([
    ['one of the core variables', 'phoenixInstanceId'],
    ['an engine object', 'execution'],
    ['an invalid name', 'Lane'],
  ])('refuses an output setting %s', (_label, name) => {
    const columns = TWO_INPUTS.replace('name="lane"', `name="${name}"`);
    expect(refusal(table(rule('r', ['-', '-'], ['"x"']), { columns }))).toEqual(
      forbidden('output'),
    );
  });

  it.each([
    ['an expression language', 'expressionLanguage="groovy"', 'expressionLanguage'],
    ['a type language', 'typeLanguage="x"', 'typeLanguage'],
    ['an aggregation', 'aggregation="SUM"', 'aggregation'],
  ])('refuses %s', (_label, attribute, field) => {
    const xml = table(RULES).replace('hitPolicy="FIRST"', `hitPolicy="FIRST" ${attribute}`);
    expect(refusal(xml)).toEqual(forbidden(field));
  });

  it.each(['COLLECT', 'RULE ORDER', 'PRIORITY'])('refuses the hit policy %s', (hitPolicy) => {
    expect(refusal(table(RULES, { hitPolicy }))).toEqual(forbidden('hitPolicy'));
  });

  it('refuses a type it does not know', () => {
    const columns = TWO_INPUTS.replace('typeRef="number"', 'typeRef="java.lang.Runtime"');
    expect(refusal(table(RULES, { columns }))).toEqual(forbidden('typeRef'));
  });

  it.each([
    [
      'a decision literal expression',
      '<literalExpression id="l"><text>1</text></literalExpression>',
      'literalExpression',
    ],
    ['an item definition', '<itemDefinition id="it"/>', 'itemDefinition'],
    ['a knowledge requirement', '<knowledgeRequirement id="k"/>', 'knowledgeRequirement'],
    ['extension elements', '<extensionElements/>', 'extensionElements'],
  ])('refuses %s', (_label, element, field) => {
    const xml = table(RULES).replace('<decisionTable', `${element}<decisionTable`);
    expect(refusal(xml)).toEqual(forbidden(field));
  });

  it('refuses a DOCTYPE and entities', () => {
    const xml = table(RULES).replace('<definitions', '<!DOCTYPE x [<!ENTITY e "1">]><definitions');
    expect(refusal(xml)).toEqual(forbidden('declaration'));
  });

  it('refuses a rule without one entry per column', () => {
    expect(refusal(table(rule('r', ['-'], ['"x"'])))).toEqual({ code: 'process.dmn.malformed' });
  });

  it('refuses an input column without its expression', () => {
    const columns = TWO_INPUTS.replace(/<inputExpression id="ie2"[^]*?<\/inputExpression>/, '');
    expect(refusal(table(rule('r', ['-', '-'], ['"x"']), { columns }))).toEqual({
      code: 'process.dmn.malformed',
    });
  });

  it('refuses a table whose decision is not the published key, or two decisions', () => {
    expect(refusal(table(RULES), 'other-key')).toEqual({
      code: 'process.dmn.decision-key-mismatch',
    });
    const two = table(RULES).replace('</definitions>', '<decision id="second"/></definitions>');
    expect(refusal(two)).toEqual({ code: 'process.dmn.decision-key-mismatch' });
  });

  it('refuses a table past its size or rule limits', () => {
    expect(refusal(table(RULES) + ' '.repeat(MAX_DMN_BYTES))).toEqual({
      code: 'process.dmn.too-large',
    });
    const many = Array.from({ length: MAX_DMN_RULES + 1 }, (_, n) =>
      rule(`r${n}`, ['-', '-'], ['1']),
    ).join('');
    expect(refusal(table(many))).toEqual(forbidden('rule'));
  });
});
