/** What every block receives besides its own props: the viewer's locale, calendar and UI labels. */
export interface BlockContext {
  locale: string;
  calendar: string;
  /** UI strings the blocks need (landmark names, "read more"), from the app's catalogue. */
  labels: Record<string, string>;
}

/** A node of the Puck JSON tree (Puck's `Data.content` item). */
export interface PageNode {
  type: string;
  props: Record<string, unknown>;
}

/** A published page version: Puck `Data` plus the version facts the portal shows nothing of. */
export interface PageData {
  root: { props?: Record<string, unknown> };
  content: PageNode[];
}

// Prop readers. Data is untrusted: a prop that is not of the expected shape becomes empty,
// never an object that could reach the DOM as markup.
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function list<T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(read);
}

/**
 * A link target from data, or null. Only same-site paths, fragments, https and mailto pass;
 * `javascript:`, `data:` and protocol-relative URLs do not (React escapes text, not hrefs).
 */
export function safeHref(value: unknown): string | null {
  const href = text(value).trim();
  if (/^\/(?!\/)/.test(href) || /^#[\w-]*$/.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
  } catch {
    return null;
  }
}
