// Site theme tokens with inheritance down the site tree (ADR-0018 decision 5): a child site
// inherits every token of its parent, may override any token that no ancestor locked, and an
// override of a locked token is refused and reported (the ministry logo colour, for example).
// The platform default theme is the root of every chain. Values are validated by kind, so a
// token can never carry CSS other than its own value (it is written into a stylesheet).

export type TokenKind = 'color' | 'length';

/** The token vocabulary. A site theme can set only these names. */
export const TOKENS = {
  'color.page': 'color',
  'color.surface': 'color',
  'color.subtle': 'color',
  'color.fg': 'color',
  'color.fg-muted': 'color',
  'color.line': 'color',
  'color.accent': 'color',
  'color.accent-hover': 'color',
  'color.on-accent': 'color',
  'color.link': 'color',
  'color.focus': 'color',
  'color.critical': 'color',
  'color.critical-bg': 'color',
  'color.brand': 'color',
  'color.on-brand': 'color',
  'radius.card': 'length',
  'radius.control': 'length',
} as const satisfies Record<string, TokenKind>;

export type TokenName = keyof typeof TOKENS;
export type TokenValues = Partial<Record<TokenName, string>>;

export interface SiteTheme {
  siteId: string;
  tokens: Record<string, string>;
  /** Tokens this site fixes for its whole subtree. */
  locked?: string[];
}

export interface ResolvedTheme {
  tokens: Record<TokenName, string>;
  /** Which site set each token's value. */
  source: Record<TokenName, string>;
  /** Tokens locked for this site, with the ancestor that locked each one. */
  lockedBy: Partial<Record<TokenName, string>>;
  /** Overrides that were refused: locked above, unknown name or invalid value. */
  refused: { siteId: string; token: string; reason: 'locked' | 'unknown' | 'invalid' }[];
}

const VALID: Record<TokenKind, RegExp> = {
  color: /^#[0-9a-fA-F]{6}$/,
  length: /^(0|\d{1,3}(\.\d{1,3})?(px|rem))$/,
};

const isToken = (name: string): name is TokenName => Object.hasOwn(TOKENS, name);

/**
 * Resolves a theme from the root of the chain to the site: `chain[0]` is the platform default
 * (it must set every token), then each ancestor, then the site itself.
 */
export function resolveTheme(chain: SiteTheme[]): ResolvedTheme {
  const [base, ...rest] = chain;
  if (!base) throw new Error('a theme chain starts with the platform default');
  const tokens = {} as Record<TokenName, string>;
  const source = {} as Record<TokenName, string>;
  const lockedBy: Partial<Record<TokenName, string>> = {};
  const refused: ResolvedTheme['refused'] = [];

  for (const [index, site] of [base, ...rest].entries()) {
    for (const [name, value] of Object.entries(site.tokens)) {
      if (!isToken(name)) {
        refused.push({ siteId: site.siteId, token: name, reason: 'unknown' });
      } else if (!VALID[TOKENS[name]].test(value)) {
        refused.push({ siteId: site.siteId, token: name, reason: 'invalid' });
      } else if (lockedBy[name] !== undefined) {
        refused.push({ siteId: site.siteId, token: name, reason: 'locked' });
      } else {
        tokens[name] = value;
        source[name] = site.siteId;
      }
    }
    // A lock takes effect for the descendants, after the site's own values are applied.
    for (const name of site.locked ?? []) {
      if (isToken(name) && lockedBy[name] === undefined) lockedBy[name] = site.siteId;
    }
    if (index === 0) {
      const missing = Object.keys(TOKENS).filter((name) => !isToken(name) || !tokens[name]);
      if (missing.length > 0) throw new Error(`platform default misses ${missing.join(', ')}`);
    }
  }
  return { tokens, source, lockedBy, refused };
}

/** The CSS custom property of a token: color.fg-muted -> --px-color-fg-muted. */
export const cssVariable = (name: TokenName) => `--px-${name.replace('.', '-')}`;

/** The resolved theme as a stylesheet body (values were validated by kind above). */
export function themeStylesheet(theme: ResolvedTheme): string {
  const lines = (Object.keys(theme.tokens) as TokenName[]).map(
    (name) => `  ${cssVariable(name)}: ${theme.tokens[name]};`,
  );
  return `:root {\n${lines.join('\n')}\n}\n`;
}

// WCAG 2.1 relative luminance and contrast ratio, to check a theme before it is published.
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

/** Foreground/background pairs the blocks use, with the WCAG AA minimum for each. */
export const CONTRAST_PAIRS: [TokenName, TokenName, number][] = [
  ['color.fg', 'color.page', 4.5],
  ['color.fg', 'color.surface', 4.5],
  ['color.fg-muted', 'color.surface', 4.5],
  ['color.fg-muted', 'color.page', 4.5],
  ['color.link', 'color.page', 4.5],
  ['color.link', 'color.surface', 4.5],
  ['color.on-accent', 'color.accent', 4.5],
  ['color.on-accent', 'color.accent-hover', 4.5],
  ['color.on-brand', 'color.brand', 4.5],
  ['color.critical', 'color.surface', 4.5],
  ['color.critical', 'color.critical-bg', 4.5],
  ['color.focus', 'color.page', 3],
  ['color.line', 'color.surface', 3],
];

/**
 * Backgrounds a focused control can sit on. The focus ring is two-tone (focus colour outline
 * over a surface-colour halo, styles.css), so it is visible (3:1, WCAG 1.4.11) when either
 * tone contrasts with the background: a single-colour ring failed on the brand header (1.8:1).
 */
export const FOCUS_BACKGROUNDS: TokenName[] = [
  'color.page',
  'color.surface',
  'color.subtle',
  'color.brand',
  'color.accent',
];

const round = (n: number) => Math.round(n * 100) / 100;

/** Pairs that fail AA. Studio should run this when a theme is saved and refuse to publish. */
export function contrastFailures(theme: ResolvedTheme) {
  const pairs = CONTRAST_PAIRS.map(([fg, bg, min]) => ({
    fg: fg as string,
    bg: bg as string,
    min,
    ratio: round(contrastRatio(theme.tokens[fg], theme.tokens[bg])),
  }));
  const rings = FOCUS_BACKGROUNDS.map((bg) => ({
    fg: 'focus ring',
    bg: bg as string,
    min: 3,
    ratio: round(
      Math.max(
        contrastRatio(theme.tokens['color.focus'], theme.tokens[bg]),
        contrastRatio(theme.tokens['color.surface'], theme.tokens[bg]),
      ),
    ),
  }));
  return [...pairs, ...rings].filter((pair) => pair.ratio < pair.min);
}
