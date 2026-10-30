/**
 * The XML grammar the process module's intake checks read (bpmn-guard.ts, dmn-guard.ts): a
 * scanner, not a parser, so anything it cannot read is refused. It accepts well-formed XML 1.0
 * in UTF-8 with one root, without a DOCTYPE, entity declarations or processing instructions
 * other than the XML declaration. Comments are dropped and CDATA joins the text around it, as
 * the engine reads them: a check judges the whole text of an element at its end tag, never one
 * run. Pure, no I/O.
 */

/** Why the scanner itself refused: unreadable XML, or a declaration it never accepts. */
export type XmlScanFailure = { readonly kind: 'malformed' } | { readonly kind: 'declaration' };

export interface XmlStartTag {
  /** The qualified name, prefix included. */
  readonly name: string;
  /** The local name. */
  readonly element: string;
  /** The local name of the enclosing element; undefined for the root. */
  readonly parent: string | undefined;
  /** Every attribute by qualified name, values decoded, in document order; no name twice. */
  readonly attributes: readonly (readonly [string, string])[];
  readonly selfClosing: boolean;
}

/** What a check does with each tag: null to read on, or its own refusal to stop. */
export interface XmlHandlers<F> {
  start(tag: XmlStartTag): F | null;
  /** The element's whole text, as the engine reads it. */
  end(element: string, text: string): F | null;
}

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
};

/** The text a parser sees: character and predefined references decoded; null if undefined. */
function decode(raw: string): string | null {
  let failed = false;
  const text = raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);|&/g, (all, ref) => {
    if (ref === undefined) {
      failed = true;
      return all;
    }
    const name = ref as string;
    if (name.startsWith('#')) {
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1));
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) {
        failed = true;
        return all;
      }
      return String.fromCodePoint(code);
    }
    const value = PREDEFINED[name];
    if (value === undefined) failed = true;
    return value ?? all;
  });
  return failed ? null : text;
}

export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const NAME = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
const START_TAG = new RegExp(
  `^<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`,
);
const END_TAG = new RegExp(`^</(${NAME})\\s*>`);
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g');
const XML_DECLARATION = /^<\?xml\s[^?]*\?>/;
/** XML 1.0, in UTF-8 when an encoding is named: the bytes the core checked are the engine's. */
const DECLARATION = new RegExp(
  `^<\\?xml\\s+version\\s*=\\s*(["'])1\\.0\\1(?:\\s+encoding\\s*=\\s*(["'])UTF-8\\2)?` +
    `(?:\\s+standalone\\s*=\\s*(["'])(?:yes|no)\\3)?\\s*\\?>$`,
  'i',
);

const MALFORMED: XmlScanFailure = Object.freeze({ kind: 'malformed' });
const DECLARATION_REFUSED: XmlScanFailure = Object.freeze({ kind: 'declaration' });

/** Reads `xml` through `handlers`: null when all of it was read and accepted. */
export function scanXml<F>(xml: string, handlers: XmlHandlers<F>): F | XmlScanFailure | null {
  const open: { readonly name: string; readonly element: string; text: string }[] = [];
  let rootSeen = false;
  let at = 0;
  const body = xml.replace(/^\uFEFF/, '');
  const declaration = XML_DECLARATION.exec(body);
  if (declaration !== null) {
    if (!DECLARATION.test(declaration[0])) return DECLARATION_REFUSED;
    at = declaration[0].length + (xml.startsWith('\uFEFF') ? 1 : 0);
  }

  while (at < xml.length) {
    const next = xml.indexOf('<', at);
    const textEnd = next === -1 ? xml.length : next;
    const text = decode(xml.slice(at, textEnd));
    if (text === null) return MALFORMED;
    if (open.length === 0) {
      if (text.trim().length > 0) return MALFORMED;
    } else {
      open[open.length - 1]!.text += text;
    }
    if (next === -1) break;
    at = next;
    const rest = xml.slice(at);

    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end === -1 || rest.slice(4, end).includes('--')) return MALFORMED;
      at += end + 3;
      continue;
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = rest.indexOf(']]>');
      if (end === -1 || open.length === 0) return MALFORMED;
      open[open.length - 1]!.text += rest.slice(9, end);
      at += end + 3;
      continue;
    }
    // A DOCTYPE, an entity declaration or a processing instruction: never accepted.
    if (rest.startsWith('<!') || rest.startsWith('<?')) return DECLARATION_REFUSED;

    const end = END_TAG.exec(rest);
    if (end !== null) {
      const closed = open.pop();
      if (closed === undefined || closed.name !== end[1]) return MALFORMED;
      const refused = handlers.end(closed.element, closed.text);
      if (refused !== null) return refused;
      at += end[0].length;
      continue;
    }
    const start = START_TAG.exec(rest);
    if (start === null) return MALFORMED;
    const [whole, name, attributeText, selfClosing] = start as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (open.length === 0 && rootSeen) return MALFORMED;
    rootSeen = true;
    const attributes: [string, string][] = [];
    for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
      const value = decode(attribute[2] ?? attribute[3] ?? '');
      if (value === null) return MALFORMED;
      if (attributes.some(([seen]) => seen === attribute[1])) return MALFORMED;
      attributes.push([attribute[1]!, value]);
    }
    const element = localName(name);
    const refused = handlers.start({
      name,
      element,
      parent: open[open.length - 1]?.element,
      attributes,
      selfClosing: selfClosing === '/',
    });
    if (refused !== null) return refused;
    if (selfClosing !== '/') {
      open.push({ name, element, text: '' });
    } else {
      // An empty element ends where it starts: its text is empty.
      const ended = handlers.end(element, '');
      if (ended !== null) return ended;
    }
    at += whole.length;
  }
  if (!rootSeen || open.length > 0) return MALFORMED;
  return null;
}

/** Whether `failure` is the scanner's own refusal rather than a check's. */
export const isScanFailure = (failure: unknown): failure is XmlScanFailure =>
  typeof failure === 'object' && failure !== null && 'kind' in failure;
