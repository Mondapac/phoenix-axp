// Lint rules for the panels, the portal and packages/ui (ADR-0008 decision 5, ADR-0016 decision
// 2; ported from PoC 4, adapted from MondaPac's panel-rules.mjs, MP ADR-0033 decisions 2 and 10).
// They are no-restricted-syntax selectors; eslint.config.mjs applies them to packages/ui and the
// web apps, and ui-rules.spec.mjs shows each one fires and does not false-positive.

// A colour written as a value: hex, a colour function, an arbitrary colour utility, white/black
// and Tailwind palette utilities (the palette is off, so such a class would render nothing).
export const RAW_COLOUR =
  '(^|[^\\w&])#((?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b' +
  '|\\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\(' +
  '|-\\[(#|rgb|hsl|oklch)' +
  '|(^|[\\s:!])(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration)-(white|black)(?=$|[\\s\\x2f])' +
  '|(^|[\\s:!])(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d';

// A physical (left/right) utility, with or without a variant prefix (md:, hover:, rtl:, !).
export const PHYSICAL_UTILITY =
  '(^|[\\s:!])-?(' +
  '(pl|pr|ml|mr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr|inset-l|inset-r)-(\\d|\\[|px(?=$|[\\s\\x2f])|auto|full|1\\x2f2)' +
  '|(rounded|border)-(l|r|tl|tr|bl|br)(?=$|[\\s-])' +
  '|(text|float|clear)-(left|right)(?=$|\\s)' +
  ')';

// A physical property in a React style object (style={{ marginLeft: 4 }}).
const PHYSICAL_STYLE_KEY =
  '^(marginLeft|marginRight|paddingLeft|paddingRight|left|right|borderLeft\\w*|borderRight\\w*|borderTopLeft\\w*|borderTopRight\\w*|borderBottomLeft\\w*|borderBottomRight\\w*)$';

const both = (regex, message) =>
  ['Literal', 'TemplateElement'].map((node) => ({
    selector:
      node === 'Literal' ? `Literal[value=/${regex}/]` : `TemplateElement[value.raw=/${regex}/]`,
    message,
  }));

const LOGICAL =
  'logical-properties-only: use start/end (ps, pe, ms, me, start, end, border-s, border-e, rounded-s, text-start, text-end; marginInlineStart in style objects), ADR-0008 decision 5.';

export const uiSyntaxRules = [
  ...both(
    RAW_COLOUR,
    'tokens-only: use a colour token, never a raw colour value (ADR-0016 decision 2).',
  ),
  ...both(PHYSICAL_UTILITY, LOGICAL),
  { selector: `Property[key.name=/${PHYSICAL_STYLE_KEY}/]`, message: LOGICAL },
  {
    selector: 'Property[key.name=/^(textAlign|float|clear)$/][value.value=/^(left|right)$/]',
    message: LOGICAL,
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'no-raw-html: dangerouslySetInnerHTML is banned; render data through the registry.',
  },
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'no-raw-html: no innerHTML/outerHTML assignment.',
  },
];
