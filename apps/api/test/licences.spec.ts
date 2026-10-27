import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The licence gate of ADR-0009 (scripts/check-licences.mjs), run as `pnpm licences` runs it but
// on saved listings, so each rule is proven on a fixture: the closed allowed list, the reviewed
// exceptions file, the full tree with dev dependencies, and the families that always fail.

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GATE = path.join(REPO_ROOT, 'scripts/check-licences.mjs');

type Listing = Record<string, { name: string; versions: string[] }[]>;
interface Exception {
  package: string;
  licence: string;
  reason: string;
  approver: string;
  date: string;
}

const pkg = (name: string) => ({ name, versions: ['1.0.0'] });
const approved = (name: string, licence: string, reason = 'reviewed for the test'): Exception => ({
  package: name,
  licence,
  reason,
  approver: 'cto',
  date: '2026-10-27',
});

describe('the licence gate (scripts/check-licences.mjs, ADR-0009)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'licences-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs the gate; `production` defaults to the whole listing (everything ships). */
  function gate(
    all: Listing,
    exceptions: unknown,
    production: Listing = all,
  ): { status: number; out: string; problems: string[] } {
    const files = {
      all: path.join(dir, 'all.json'),
      prod: path.join(dir, 'prod.json'),
      exceptions: path.join(dir, 'exceptions.json'),
    };
    writeFileSync(files.all, JSON.stringify(all));
    writeFileSync(files.prod, JSON.stringify(production));
    writeFileSync(files.exceptions, JSON.stringify(exceptions));
    const argv = [
      GATE,
      '--all-json',
      files.all,
      '--prod-json',
      files.prod,
      '--exceptions',
      files.exceptions,
    ];
    try {
      const out = execFileSync(process.execPath, argv, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, out, problems: [] };
    } catch (error) {
      const { status, stderr } = error as { status: number; stderr: string };
      const problems = stderr
        .split('\n')
        .filter((line) => line.startsWith('  - '))
        .map((line) => line.slice(4));
      return { status, out: stderr, problems };
    }
  }

  it('passes the five allowed licences silently, and expressions built only from them', () => {
    const result = gate(
      {
        MIT: [pkg('a')],
        'Apache-2.0': [pkg('b')],
        'BSD-2-Clause': [pkg('c')],
        'BSD-3-Clause': [pkg('d')],
        ISC: [pkg('e')],
        'Apache-2.0 AND MIT': [pkg('f')],
        'MIT and ISC': [pkg('g')],
        '(MIT OR CC0-1.0)': [pkg('h')],
        '(GPL-3.0 OR MIT)': [pkg('i')],
      },
      [],
    );
    expect(result).toMatchObject({ status: 0, problems: [] });
    expect(result.out).toContain('0 reviewed exception(s)');
    expect(result.out).not.toContain('exception:');
  });

  it.each(['MIT-0', '0BSD', 'BlueOak-1.0.0', 'MPL-2.0', 'Unlicense', 'CC0-1.0', 'EPL-2.0'])(
    'fails %s without an exception (outside the closed list)',
    (licence) => {
      expect(gate({ [licence]: [pkg('x')] }, [])).toMatchObject({
        status: 1,
        problems: [
          `x@1.0.0 (${licence}): not allowed by ADR-0009; needs a cto-approved entry in ` +
            'config/licence-exceptions.json',
        ],
      });
    },
  );

  it('fails an AND that holds one licence outside the list', () => {
    expect(gate({ 'MIT AND 0BSD': [pkg('x')] }, []).status).toBe(1);
  });

  it('passes a licence listed in the exceptions file for that package and that licence', () => {
    const result = gate({ '0BSD': [pkg('tslib')] }, [approved('tslib', '0BSD')]);
    expect(result).toMatchObject({ status: 0, problems: [] });
    expect(result.out).toContain('exception: tslib@1.0.0 (0BSD): reviewed for the test');
  });

  it('an exception covers only its own package and its own licence', () => {
    expect(
      gate({ '0BSD': [pkg('other')], 'MIT-0': [pkg('tslib')] }, [approved('tslib', '0BSD')])
        .problems,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^other@1\.0\.0 \(0BSD\): not allowed/),
        expect.stringMatching(/^tslib@1\.0\.0 \(MIT-0\): not allowed/),
        'exception tslib (0BSD) matches no package; remove it from config/licence-exceptions.json',
      ]),
    );
  });

  it.each([
    'GPL-3.0',
    'GPL-2.0-only',
    'AGPL-3.0-or-later',
    'LGPL-2.1',
    'SSPL-1.0',
    'BUSL-1.1',
    'MIT AND GPL-3.0',
    'GNU General Public License v3',
    'GNU Lesser General Public License',
    'GNU Affero General Public License v3.0',
    'Business Source License 1.1',
    'Server Side Public License',
    'Sustainable Use License',
    'MIT with Commons Clause',
    'LicenseRef-GPL',
    'LicenseRef-Custom-LGPL-2.1',
    'MIT AND (0BSD OR Server Side Public License)',
  ])('always fails %s, even when listed as an exception', (licence) => {
    const result = gate({ [licence]: [pkg('x')] }, [approved('x', licence)]);
    expect(result.status).toBe(1);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        `exception #1 (x): ${licence} is forbidden by ADR-0009 and cannot be excepted`,
        `x@1.0.0 (${licence}): forbidden by ADR-0009, whatever the exceptions file says`,
      ]),
    );
  });

  it('fails a package with no or an unknown licence', () => {
    expect(gate({ Unknown: [pkg('x')] }, []).problems).toEqual([
      'x@1.0.0 (Unknown): no or unknown licence',
    ]);
  });

  it('checks the full tree: a dev-only package fails without an exception', () => {
    const result = gate({ MIT: [pkg('app')], 'BlueOak-1.0.0': [pkg('glob')] }, [], {
      MIT: [pkg('app')],
    });
    expect(result.problems).toEqual([
      'glob@1.0.0 (BlueOak-1.0.0): not allowed by ADR-0009; needs a cto-approved entry in ' +
        'config/licence-exceptions.json (dev-only)',
    ]);
  });

  it('passes a dev-only package excepted as "dev-only, not shipped"', () => {
    expect(
      gate(
        { MIT: [pkg('app')], 'BlueOak-1.0.0': [pkg('glob')] },
        [approved('glob', 'BlueOak-1.0.0', 'dev-only, not shipped')],
        { MIT: [pkg('app')] },
      ),
    ).toMatchObject({ status: 0, problems: [] });
  });

  it('fails a "dev-only, not shipped" exception whose package ships', () => {
    expect(
      gate({ 'BlueOak-1.0.0': [pkg('glob')] }, [
        approved('glob', 'BlueOak-1.0.0', 'dev-only, not shipped'),
      ]).problems,
    ).toEqual([
      'glob@1.0.0 (BlueOak-1.0.0): excepted as "dev-only, not shipped", but it is a production package',
    ]);
  });

  it('refuses an exception without the cto approval, a date, a reason or with an extra field', () => {
    const entries = [
      { ...approved('a', '0BSD'), approver: 'backend' },
      { ...approved('b', '0BSD'), date: 'yesterday' },
      { ...approved('c', '0BSD'), reason: '' },
      { ...approved('d', '0BSD'), scope: 'everything' },
      approved('e', 'MIT'),
      approved('f', '0BSD'),
      approved('f', '0BSD'),
    ];
    const result = gate({ '0BSD': [pkg('a'), pkg('b'), pkg('c'), pkg('d'), pkg('f')] }, entries);
    expect(result.status).toBe(1);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        'exception #1 (a): the approver must be "cto" (ADR-0009), not "backend"',
        'exception #2 (b): "date" must be a date (YYYY-MM-DD)',
        'exception #3 (c): "reason" is required',
        'exception #4 (d): unknown field(s) scope',
        'exception #5 (e): MIT is already allowed; remove the entry',
        'exception #7 (f): listed twice for 0BSD',
      ]),
    );
    // An invalid file excuses nothing.
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.stringMatching(/^f@1\.0\.0 \(0BSD\): not allowed/)]),
    );
  });

  it('refuses an exceptions file that is not an array', () => {
    expect(gate({ MIT: [pkg('a')] }, { tslib: '0BSD' }).problems).toEqual([
      'the exceptions file must hold a JSON array',
    ]);
  });
});
