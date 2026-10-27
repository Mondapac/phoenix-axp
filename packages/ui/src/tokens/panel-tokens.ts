// Panel design tokens (ADR-0016 decision 5): one fixed product palette for apps/admin and
// apps/studio, a light and a dark set. A tenant changes only its logo and name in the panels;
// brand tokens are the portal's (site themes). The values are ours: Metronic is a reference for
// density and hierarchy only, and none of its tokens are used.
//
// This file is the source of truth. `pnpm --filter @phoenix/ui tokens` writes tokens.css from it,
// and tokens.spec.ts fails when the two differ or a pair misses WCAG 2.1 AA. It imports nothing,
// so the generator script can load it with Node's own TypeScript support.

/** Colour tokens: every one has a light and a dark value (#rrggbb, or rgba for overlays). */
export const COLOR_TOKENS = {
  // Surfaces
  page: ['#f4f5f7', '#0e1014'],
  surface: ['#ffffff', '#16191f'],
  raised: ['#ffffff', '#1d2129'],
  subtle: ['#f0f1f4', '#20242c'],
  hover: ['#e9ebef', '#272c35'],
  // Text
  fg: ['#16181d', '#eceef2'],
  'fg-muted': ['#5a606b', '#a3a9b4'],
  // Lines: `line` is decorative (dividers, card edges); `line-strong` bounds a control (3:1).
  line: ['#e3e6eb', '#2a2f38'],
  'line-strong': ['#868d99', '#6b7380'],
  // Accent (primary action, selection, links)
  accent: ['#2456d6', '#5b8cff'],
  'accent-hover': ['#1c45ad', '#7aa2ff'],
  'on-accent': ['#ffffff', '#0b1020'],
  'accent-subtle': ['#e9effd', '#1b2744'],
  'accent-fg': ['#1d48b5', '#a8c2ff'],
  link: ['#2456d6', '#8eb0ff'],
  focus: ['#2456d6', '#8eb0ff'],
  // Status
  critical: ['#c0261b', '#ff8a80'],
  'critical-hover': ['#9e1f16', '#ffa59d'],
  'on-critical': ['#ffffff', '#1f0605'],
  'critical-bg': ['#fdeceb', '#3a1513'],
  success: ['#17793f', '#5fd38d'],
  'success-bg': ['#e6f5ec', '#102e1d'],
  warning: ['#8f5a00', '#f2b84b'],
  'warning-bg': ['#fdf3e1', '#33260c'],
  info: ['#0d6c8f', '#62c6eb'],
  'info-bg': ['#e3f3f9', '#0e2a35'],
  // Side menu
  sidebar: ['#ffffff', '#121419'],
  'sidebar-fg': ['#3d434d', '#b7bcc6'],
  'sidebar-active': ['#e9effd', '#1b2744'],
  'sidebar-active-fg': ['#1d48b5', '#a8c2ff'],
  // Backdrop behind a dialog or sheet
  overlay: ['rgba(14, 16, 20, 0.45)', 'rgba(0, 0, 0, 0.6)'],
} as const satisfies Record<string, readonly [string, string]>;

/** Theme-independent tokens: radii, shell sizes, shadows. */
export const SIZE_TOKENS = {
  'radius-control': '0.5rem',
  'radius-card': '0.75rem',
  'radius-pill': '999px',
  'sidebar-width': '17.5rem',
  'sidebar-collapsed-width': '4.5rem',
  'header-height': '4.5rem',
  'shadow-card': '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
  'shadow-popup': '0 8px 24px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.08)',
} as const satisfies Record<string, string>;

export type ColorToken = keyof typeof COLOR_TOKENS;
export type Theme = 'light' | 'dark';

/** The CSS custom property of a colour token: fg-muted -> --px-color-fg-muted. */
export const colorVariable = (name: string) => `--px-color-${name}`;

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.join('\n')}\n}\n`;
const colours = (index: 0 | 1) =>
  Object.entries(COLOR_TOKENS).map(
    ([name, values]) => `  ${colorVariable(name)}: ${values[index]};`,
  );

/**
 * tokens.css: the light set on :root, the dark set for `.dark` on <html> and, when the server
 * set neither `.light` nor `.dark`, for a system preference of dark (the default is "system").
 */
export function tokensStylesheet(): string {
  const sizes = Object.entries(SIZE_TOKENS).map(([name, value]) => `  --px-${name}: ${value};`);
  return [
    '/* Generated from panel-tokens.ts by `pnpm --filter @phoenix/ui tokens`. Do not edit. */\n',
    block(':root', ['  color-scheme: light;', ...sizes, ...colours(0)]),
    block(':root.dark', ['  color-scheme: dark;', ...colours(1)]),
    '@media (prefers-color-scheme: dark) {\n' +
      block(':root:not(.light)', ['  color-scheme: dark;', ...colours(1)])
        .split('\n')
        .map((line) => (line === '' ? line : `  ${line}`))
        .join('\n') +
      '}\n',
  ].join('\n');
}
