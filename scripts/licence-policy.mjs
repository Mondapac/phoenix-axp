// The licence policy of ADR-0009, as pure functions: `check-licences.mjs` applies it to the
// pnpm listings, and apps/api/test/licences.spec.ts proves each rule on fixtures.
//
//   - ALLOWED licences (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC: ADR-0009 decision 1;
//     0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0: ADR-0022 decision 4) pass silently.
//     An exception for an allowed licence is refused as unneeded.
//   - DENIED families (GPL, LGPL, AGPL, SSPL, BUSL, the Sustainable Use and similar licences)
//     always fail, even when listed as an exception (ADR-0009 decision 2). They are recognised
//     by their SPDX ids and by their names written out anywhere in the declared licence
//     ("GNU General Public License v3", "Server Side Public License", "LicenseRef-GPL", ...),
//     so a non-SPDX spelling cannot turn a denied licence into one that an exception passes.
//   - Every other licence, MIT-0, MPL-2.0 and EPL-2.0 included (ADR-0022 decision 4 keeps
//     MPL-2.0 and EPL-2.0 case by case), fails unless config/licence-exceptions.json lists that
//     package under that exact licence, with a reason, the approver `cto` and a date
//     (ADR-0009 decision 2 and its Consequences: "CI lists them as failures and `cto` approves each one explicitly").
//   - A package with no or an unknown licence always fails (ADR-0009 decision 3).
//   - The whole dependency tree is checked, dev dependencies included (ADR-0009 decision 3).
//     An exception whose reason is DEV_ONLY_REASON fails when that package ships (is in the
//     production closure).
//   - An exception that matches no package fails, so the reviewed list never outlives its use.
//   - SIL OFL-1.1 passes for font packages only (ADR-0022 decision 3): a package of the
//     FONT_PACKAGE family, whose files are fonts used unmodified and served from our own origin.
//     OFL-1.1 on any other package still needs an exception. The gate checks the name only;
//     "unmodified, self-hosted" is kept by review (the panels bundle the files, no font CDN).
//
// An SPDX expression passes when one alternative of an OR passes, and an AND only when every
// part passes; `WITH` and anything unparsed need an exception. An OR with an allowed choice
// passes even when another choice is denied: "MIT OR GPL-3.0" is taken under MIT.

export const ALLOWED = new Set([
  // ADR-0009 decision 1.
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  // ADR-0022 decision 4 (owner decision P4, limited widening).
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
]);

/** Refused whatever the exceptions file says: incompatible with a proprietary product. */
export const DENIED =
  /^(A?GPL|LGPL|SSPL|BUSL|SUL|Sustainable|Elastic|CC-BY-NC|CC-BY-SA|EUPL|OSL|CPAL|RPL|Commons-Clause)/i;

/**
 * The denied families written out, matched anywhere in the declared licence (not only at the
 * start of an id): free-text names and LicenseRef- ids that name a GPL variant.
 */
export const DENIED_WORDS =
  /General\s+Public\s+Licen[cs]e|Lesser\s+General\s+Public|Affero|Business\s+Source|Server\s+Side\s+Public|Sustainable\s+Use|Commons[\s-]+Clause|LicenseRef-[\w.+-]*GPL/i;

/** ADR-0022 decision 3: the font licence, and the packages that hold font files only. */
export const FONT_LICENCE = 'OFL-1.1';
export const FONT_PACKAGE = /^@fontsource(-variable)?\/[a-z0-9-]+$/;

/** Whether a package passes as a font under the font licence (ADR-0022 decision 3). */
export const isFontPackage = (name, licence) =>
  licence.trim() === FONT_LICENCE && FONT_PACKAGE.test(name);

/** The reason that marks an exception as dev-only: such a package may never ship. */
export const DEV_ONLY_REASON = 'dev-only, not shipped';

const UNKNOWN = new Set(['', 'Unknown', 'UNKNOWN', 'UNLICENSED', 'SEE LICENSE IN LICENSE']);

/** The SPDX ids of an expression, without operators and parentheses. */
export function licenceIds(expression) {
  return expression
    .split(/[\s()]+/)
    .filter((token) => token !== '' && !/^(AND|OR|WITH)$/i.test(token));
}

/** Whether any id of the expression is in a denied family, or the expression names one. */
export function mentionsDenied(expression) {
  return (
    DENIED_WORDS.test(expression) ||
    licenceIds(expression).some((id) => DENIED.test(id.replace(/^\(+/, '')))
  );
}

/** Splits `text` at a top-level binary operator (outside parentheses). */
function splitTopLevel(text, operator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const pattern = new RegExp(`^\\s+${operator}\\s+`, 'i');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0) {
      const match = pattern.exec(text.slice(index));
      if (match) {
        parts.push(text.slice(start, index));
        index += match[0].length - 1;
        start = index + 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/** Removes parentheses that wrap the whole expression. */
function unwrap(text) {
  let current = text.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < current.length - 1; index += 1) {
      if (current[index] === '(') depth += 1;
      else if (current[index] === ')') depth -= 1;
      if (depth === 0) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

/** Whether the expression is satisfied by ALLOWED licences alone. */
export function isAllowed(expression) {
  const text = unwrap(expression);
  const alternatives = splitTopLevel(text, 'OR');
  if (alternatives.length > 1) return alternatives.some(isAllowed);
  const parts = splitTopLevel(text, 'AND');
  if (parts.length > 1) return parts.every(isAllowed);
  return ALLOWED.has(text);
}

/**
 * The verdict for one declared licence: 'pass' (allowed, silent), 'denied' (always fails),
 * 'unknown' (always fails) or 'review' (fails unless an exception lists it).
 */
export function verdictOf(expression) {
  if (UNKNOWN.has(expression.trim())) return 'unknown';
  if (isAllowed(expression)) return 'pass';
  if (mentionsDenied(expression)) return 'denied';
  return 'review';
}

const EXCEPTION_FIELDS = ['package', 'licence', 'reason', 'approver', 'date'];

/** The problems of the exceptions file itself; an invalid entry never excuses anything. */
export function validateExceptions(exceptions) {
  const problems = [];
  if (!Array.isArray(exceptions)) return ['the exceptions file must hold a JSON array'];
  const seen = new Set();
  exceptions.forEach((entry, index) => {
    const at = `exception #${index + 1}${entry?.package ? ` (${entry.package})` : ''}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    for (const field of EXCEPTION_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        problems.push(`${at}: "${field}" is required`);
      }
    }
    const extra = Object.keys(entry).filter((key) => !EXCEPTION_FIELDS.includes(key));
    if (extra.length > 0) problems.push(`${at}: unknown field(s) ${extra.join(', ')}`);
    if (typeof entry.approver === 'string' && entry.approver !== 'cto') {
      problems.push(`${at}: the approver must be "cto" (ADR-0009), not "${entry.approver}"`);
    }
    if (
      typeof entry.date === 'string' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date)))
    ) {
      problems.push(`${at}: "date" must be a date (YYYY-MM-DD)`);
    }
    if (typeof entry.licence === 'string') {
      if (mentionsDenied(entry.licence)) {
        problems.push(`${at}: ${entry.licence} is forbidden by ADR-0009 and cannot be excepted`);
      } else if (isAllowed(entry.licence)) {
        problems.push(`${at}: ${entry.licence} is already allowed; remove the entry`);
      }
    }
    const key = `${entry.package}\u0000${entry.licence}`;
    if (seen.has(key)) problems.push(`${at}: listed twice for ${entry.licence}`);
    seen.add(key);
  });
  return problems;
}

/** `{ licence: [{ name, versions }] }` (pnpm licenses list --json) to a list of packages. */
function packagesOf(listing) {
  const found = [];
  for (const [licence, packages] of Object.entries(listing)) {
    for (const pkg of packages) found.push({ name: pkg.name, versions: pkg.versions, licence });
  }
  return found;
}

/**
 * Applies the policy. `all` is the listing of the whole tree, `production` that of the
 * production closure only (a subset). Answers the failures, the exceptions applied and counts.
 */
export function checkLicences({ all, production, exceptions }) {
  const failures = validateExceptions(exceptions);
  const valid = Array.isArray(exceptions) && failures.length === 0 ? exceptions : [];
  const shipped = new Set(packagesOf(production).map((pkg) => `${pkg.name}\u0000${pkg.licence}`));
  const everything = new Map();
  for (const pkg of [...packagesOf(all), ...packagesOf(production)]) {
    everything.set(`${pkg.name}\u0000${pkg.licence}`, pkg);
  }
  const used = new Set();
  const applied = [];

  for (const [key, pkg] of everything) {
    const label = `${pkg.name}@${pkg.versions.join(',')} (${pkg.licence})`;
    const ships = shipped.has(key);
    const verdict = verdictOf(pkg.licence);
    if (verdict === 'pass') continue;
    if (isFontPackage(pkg.name, pkg.licence)) {
      applied.push(`${label}: font files only, self-hosted (ADR-0022 decision 3)`);
      continue;
    }
    if (verdict === 'denied') {
      failures.push(`${label}: forbidden by ADR-0009, whatever the exceptions file says`);
      continue;
    }
    if (verdict === 'unknown') {
      failures.push(`${label}: no or unknown licence`);
      continue;
    }
    const exception = valid.find(
      (entry) => entry.package === pkg.name && entry.licence === pkg.licence,
    );
    if (!exception) {
      failures.push(
        `${label}: not allowed by ADR-0009; needs a cto-approved entry in ` +
          `config/licence-exceptions.json${ships ? '' : ' (dev-only)'}`,
      );
      continue;
    }
    used.add(exception);
    if (exception.reason === DEV_ONLY_REASON && ships) {
      failures.push(`${label}: excepted as "${DEV_ONLY_REASON}", but it is a production package`);
      continue;
    }
    applied.push(`${label}: ${exception.reason} (${exception.approver}, ${exception.date})`);
  }

  for (const entry of valid) {
    if (!used.has(entry)) {
      failures.push(
        `exception ${entry.package} (${entry.licence}) matches no package; remove it from ` +
          'config/licence-exceptions.json',
      );
    }
  }

  return {
    failures,
    applied,
    total: everything.size,
    production: shipped.size,
  };
}
