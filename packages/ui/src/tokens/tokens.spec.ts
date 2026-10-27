import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastFailures } from './contrast';
import { COLOR_TOKENS, SIZE_TOKENS, tokensStylesheet } from './panel-tokens';

describe('panel tokens', () => {
  it('tokens.css is generated from panel-tokens.ts (run pnpm --filter @phoenix/ui tokens)', () => {
    const file = readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
    expect(file).toBe(tokensStylesheet());
  });

  it.each(['light', 'dark'] as const)(
    'meets WCAG 2.1 AA for every pair in the %s theme',
    (theme) => {
      expect(contrastFailures(theme)).toEqual([]);
    },
  );

  it('gives every colour a light and a dark value of a valid form', () => {
    const colour = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0?\.\d+\))$/;
    for (const [name, values] of Object.entries(COLOR_TOKENS)) {
      expect(values).toHaveLength(2);
      for (const value of values)
        expect(`${name}: ${value}`).toMatch(new RegExp(`: ${colour.source.slice(1)}`));
    }
  });

  it('maps every token to a Tailwind name in styles.css, and nothing else', () => {
    const css = readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
    const mapped = [...css.matchAll(/--color-([\w-]+): var\(--px-color-([\w-]+)\)/g)];
    expect(mapped.map((m) => m[1])).toEqual(mapped.map((m) => m[2]));
    expect(mapped.map((m) => m[1]).sort()).toEqual(Object.keys(COLOR_TOKENS).sort());
    for (const name of [
      'radius-control',
      'radius-card',
      'shadow-card',
      'sidebar-width',
      'header-height',
    ]) {
      expect(css).toContain(`var(--px-${name})`);
      expect(SIZE_TOKENS).toHaveProperty(name);
    }
  });

  it('switches the dark set on .dark and on a dark system preference unless .light is set', () => {
    const css = tokensStylesheet();
    expect(css).toContain(':root.dark {');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\.light\) \{/);
  });
});
