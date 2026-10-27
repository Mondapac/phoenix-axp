import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { portalSyntaxRules } from './portal-rules.mjs';

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-restricted-syntax': ['error', ...portalSyntaxRules] },
  },
];
const lint = (code) =>
  linter.verify(code, config, { filename: 'x.tsx' }).map((m) => m.message.split(':')[0]);

describe('portal lint rules', () => {
  const refused = [
    ['<a className="bg-[#fff]" />', 'tokens-only'],
    ['const c = "#1D4FD7";', 'tokens-only'],
    ['const c = "oklch(0.5 0.1 200)";', 'tokens-only'],
    ['<a className="text-white" />', 'tokens-only'],
    ['<a className="hover:bg-red-500" />', 'tokens-only'],
    ['<a className="pl-4" />', 'logical-properties-only'],
    ['<a className="md:mr-2" />', 'logical-properties-only'],
    ['<a className="rtl:left-0" />', 'logical-properties-only'],
    ['<a className="sm:text-left" />', 'logical-properties-only'],
    ['<a className="text-right" />', 'logical-properties-only'],
    ['<a className="float-right" />', 'logical-properties-only'],
    ['<a className="border-l" />', 'logical-properties-only'],
    ['<a className="rounded-tr-lg" />', 'logical-properties-only'],
    ['<a className="-ml-2" />', 'logical-properties-only'],
    ['<a className={`px-2 pr-3 ${x}`} />', 'logical-properties-only'],
    ['<a style={{ marginLeft: 4 }} />', 'logical-properties-only'],
    ['<a style={{ right: 0 }} />', 'logical-properties-only'],
    ['<a style={{ textAlign: "left" }} />', 'logical-properties-only'],
    ['<a dangerouslySetInnerHTML={{ __html: x }} />', 'no-raw-html'],
    ['el.innerHTML = x;', 'no-raw-html'],
  ];
  for (const [code, rule] of refused) {
    it(`refuses ${code}`, () => assert.ok(lint(code).includes(rule), lint(code).join()));
  }

  const allowed = [
    '<a className="bg-surface text-fg ps-4 pe-2 ms-auto text-start border-s rounded-control" />',
    '<a className="hover:bg-accent md:ps-4 start-0 end-0 rtl:text-end rtl:-scale-x-100" />',
    '<a style={{ marginInlineStart: 4, insetInlineEnd: 0, textAlign: "start" }} />',
    'const text = "Use the right-hand menu or the left side bar";',
    'const order = "Order #123";',
    'const url = "/settings#section";',
    'const key = "ArrowLeft";',
  ];
  for (const code of allowed) {
    it(`allows ${code}`, () => assert.deepEqual(lint(code), []));
  }
});
