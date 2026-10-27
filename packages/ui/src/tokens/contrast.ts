// WCAG 2.1 relative luminance and contrast ratio (ported from the PoC 4 theme check).
import { COLOR_TOKENS, type ColorToken, type Theme } from './panel-tokens';

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Foreground/background pairs the components use, with the WCAG AA minimum of each. */
export const CONTRAST_PAIRS: [ColorToken, ColorToken, number][] = [
  ...(['page', 'surface', 'raised', 'subtle', 'hover'] as const).flatMap(
    (bg): [ColorToken, ColorToken, number][] => [
      ['fg', bg, 4.5],
      ['fg-muted', bg, 4.5],
    ],
  ),
  ['link', 'surface', 4.5],
  ['link', 'page', 4.5],
  ['accent-fg', 'accent-subtle', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['on-critical', 'critical', 4.5],
  ['on-critical', 'critical-hover', 4.5],
  ['critical', 'surface', 4.5],
  ['critical', 'critical-bg', 4.5],
  ['success', 'success-bg', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'warning-bg', 4.5],
  ['warning', 'surface', 4.5],
  ['info', 'info-bg', 4.5],
  ['info', 'surface', 4.5],
  ['sidebar-fg', 'sidebar', 4.5],
  ['sidebar-active-fg', 'sidebar-active', 4.5],
  ['line-strong', 'surface', 3],
  ['line-strong', 'page', 3],
  ['accent', 'surface', 3],
  ['focus', 'page', 3],
  ['focus', 'surface', 3],
  ['focus', 'subtle', 3],
  ['focus', 'sidebar', 3],
];

const round = (n: number) => Math.round(n * 100) / 100;

/** Pairs below their minimum in one theme. */
export function contrastFailures(theme: Theme) {
  const index = theme === 'light' ? 0 : 1;
  return CONTRAST_PAIRS.map(([fg, bg, min]) => ({
    fg,
    bg,
    min,
    ratio: round(contrastRatio(COLOR_TOKENS[fg][index], COLOR_TOKENS[bg][index])),
  })).filter((pair) => pair.ratio < pair.min);
}
