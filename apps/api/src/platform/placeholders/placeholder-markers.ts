// Ported from Mondapac apps/api/src/platform/placeholders/placeholder-markers.ts (Mondapac
// ADR-0031). Phoenix change: only the fail-closed marker; Mondapac's `@PermissiveInterim` is not
// ported, because Phoenix ADR-0010 decisions 2 and 3 allow no permissive binding outside tests.

/**
 * Phoenix ADR-0010 decisions 2 and 4: the marker that makes a binding count against a
 * production start. `@FailClosedPlaceholder('<port>')` is a constant refusal standing in for
 * another module's unbuilt facade method; a class carrying it must be replaced (one binding PR
 * per dependency, decision 5) before the first production start.
 *
 * The mark is kept in a module-private `WeakMap`, not in reflection metadata, so nothing outside
 * this file can add, change or remove it; {@link placeholderMarkOf} is the only read.
 */
export type PlaceholderKind = 'fail-closed-placeholder';

export interface PlaceholderMark {
  readonly kind: PlaceholderKind;
  /** The consumer's port the class is bound to, for example `tenancy.isWithinSubtree`. */
  readonly port: string;
}

/** Any class, abstract or not. */
export type AnyClass = abstract new (...args: never[]) => unknown;

/** A class decorator that leaves the class as it is. */
export type PlaceholderDecorator = (target: AnyClass) => void;

const marks = new WeakMap<AnyClass, PlaceholderMark>();
/** Every marked class this process has loaded, in load order (see {@link loadedPlaceholders}). */
const loaded: { readonly target: AnyClass; readonly mark: PlaceholderMark }[] = [];

const PORT_NAME = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9-]*$/;

function marker(kind: PlaceholderKind, port: string): PlaceholderDecorator {
  if (!PORT_NAME.test(port)) {
    throw new Error(`A placeholder port is named "<module>.<method>"; got "${port}"`);
  }
  return (target) => {
    if (marks.has(target)) throw new Error(`${target.name} carries two placeholder marks`);
    const mark = { kind, port };
    marks.set(target, mark);
    loaded.push({ target, mark });
  };
}

/** Phoenix ADR-0010 decision 2: a fail-closed placeholder for `port`. */
export function FailClosedPlaceholder(port: string): PlaceholderDecorator {
  return marker('fail-closed-placeholder', port);
}

/**
 * The mark of a class or of any class it extends, or `undefined` for an ordinary binding: a
 * subclass of a placeholder is a placeholder (Hassan S2).
 */
export function placeholderMarkOf(target: unknown): PlaceholderMark | undefined {
  let current: unknown = target;
  while (typeof current === 'function') {
    const mark = marks.get(current as AnyClass);
    if (mark !== undefined) return mark;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

/**
 * Every marked class loaded into this process, whether or not the container shows it bound: a
 * class built inside a factory, or a request- or transient-scoped provider, has no instance the
 * container can show at start-up (Hassan S1). A placeholder's binding PR deletes the class
 * (decision 5), so a loaded marked class is treated as bound.
 */
export function loadedPlaceholders(): readonly {
  readonly className: string;
  readonly mark: PlaceholderMark;
}[] {
  return loaded.map(({ target, mark }) => ({ className: target.name, mark }));
}
