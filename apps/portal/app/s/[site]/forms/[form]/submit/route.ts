// The BFF side of a form submission (design doc 2): same-origin only, normalises the input
// exactly as the browser does, validates against the same form revision and answers with the
// errors (422) or the normalised data (201). The product forwards to the API, which validates
// again and stores the submission with the form revision and hash (ADR-0007 V3).
import { createAjv } from '@jsonforms/core';
import { normaliseForStorage } from '@phoenix/ui';
import { siteForm } from '../../../../../../src/server/content.ts';
import { getSite } from '../../../../../../src/server/sites.ts';

const ajv = createAjv({ allErrors: true });

type Ui = { type?: string; scope?: string; options?: { normalise?: string }; elements?: Ui[] };

/** Normalisation mode per property, read from the UI schema controls. */
function modes(ui: Ui, out = new Map<string, 'identifier' | 'text'>()) {
  if (ui.type === 'Control' && ui.scope) {
    out.set(
      ui.scope.replace('#/properties/', ''),
      ui.options?.normalise === 'identifier' ? 'identifier' : 'text',
    );
  }
  ui.elements?.forEach((child) => modes(child, out));
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ site: string; form: string }> },
) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (
    request.headers.get('sec-fetch-site') !== 'same-origin' ||
    !origin ||
    new URL(origin).host !== host
  ) {
    return Response.json({ error: 'cross-origin' }, { status: 403 });
  }
  const { site: key, form: slug } = await params;
  const site = getSite(key);
  const found = site && siteForm(site, slug);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ errors: [] }, { status: 400 });
  }
  const fieldModes = modes(found.form.uischema);
  const data = Object.fromEntries(
    Object.entries(body).map(([name, value]) => [
      name,
      typeof value === 'string'
        ? normaliseForStorage(value, fieldModes.get(name) ?? 'text')
        : value,
    ]),
  );
  const validate = ajv.compile(found.form.schema);
  if (!validate(data)) return Response.json({ errors: validate.errors }, { status: 422 });
  return Response.json({ data, form: found.form._revision, owner: found.owner }, { status: 201 });
}
