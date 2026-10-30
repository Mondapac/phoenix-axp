// Pure helpers over a UI Schema's layout tree (no React), shared by the renderers and tests.

interface Element {
  readonly type?: unknown;
  readonly scope?: unknown;
  readonly elements?: readonly unknown[];
}

/** The top-level property names the controls under `element` write (first scope segment). */
export function propertiesUnder(element: unknown): Set<string> {
  const names = new Set<string>();
  const pending: unknown[] = [element];
  while (pending.length > 0) {
    const next = pending.pop() as Element | null | undefined;
    if (typeof next !== 'object' || next === null) continue;
    if (typeof next.scope === 'string') {
      const [, properties, name] = next.scope.split('/');
      if (properties === 'properties' && name !== undefined) names.add(name);
    }
    if (Array.isArray(next.elements)) pending.push(...(next.elements as readonly unknown[]));
  }
  return names;
}

/** An Ajv error as the step check needs it. */
export interface PathError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The top-level property an Ajv error is about (a `required` error names the missing one). */
export function propertyOfError(error: PathError): string | null {
  if (error.keyword === 'required' && error.instancePath === '') {
    const missing = error.params.missingProperty;
    return typeof missing === 'string' ? missing : null;
  }
  const [, first] = error.instancePath.split('/');
  return first === undefined || first === '' ? null : first;
}

/** Whether any of `errors` is about a property a control under `step` writes. */
export function stepOfErrors(errors: readonly PathError[], step: unknown): boolean {
  const names = propertiesUnder(step);
  return errors.some((error) => {
    const name = propertyOfError(error);
    return name !== null && names.has(name);
  });
}
