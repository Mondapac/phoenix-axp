import { execFileSync } from 'node:child_process';
import path from 'node:path';

// The panel boundary check (scripts/check-panel-boundaries.mjs), run as `pnpm boundaries` runs
// it: on the fixture tree every rule fires exactly where a fixture breaks it and nowhere else,
// and the repository itself passes.

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CHECK = path.join(REPO_ROOT, 'scripts/check-panel-boundaries.mjs');
const FIXTURES = path.join(__dirname, 'boundary-fixtures/panels');

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

function run(root: string): { code: number; violations: Violation[] } {
  try {
    const out = execFileSync(process.execPath, [CHECK, '--root', root, '--json'], {
      encoding: 'utf8',
    });
    return { code: 0, violations: JSON.parse(out) as Violation[] };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { code: failed.status, violations: JSON.parse(failed.stdout) as Violation[] };
  }
}

describe('the panel boundary check', () => {
  it('reports every rule on the fixture tree, and nothing on the allowed cases', () => {
    const { code, violations } = run(FIXTURES);
    expect(code).toBe(1);
    const widget = (name: string) => `apps/studio/app/widgets/${name}`;
    expect(violations.map((v) => [v.rule, v.file, v.detail]).sort()).toEqual(
      [
        ['client-reads-no-env', widget('client-env.tsx'), 'process.env'],
        ['client-reads-no-env', widget('client-env.jsx'), 'process.env'],
        [
          'browser-calls-own-origin',
          widget('client-fetch.tsx'),
          'http://api.internal:3000/identity/staff/me',
        ],
        ['browser-calls-own-origin', widget('client-fetch.tsx'), '//api.internal/tenancy/sites'],
        [
          'panel-server-is-server-only',
          widget('client-server-import.tsx'),
          '@phoenix/panel-server',
        ],
        ['panel-server-is-server-only', widget('client-server-import.tsx'), 'next/headers'],
        ['panel-server-is-server-only', widget('client-server-import.tsx'), '../_server/panel'],
        ['no-core-imports', widget('core-import.ts'), '@phoenix/api/modules/tenancy'],
        ['no-core-imports', widget('core-import.ts'), '../../../api/src/app.module'],
        ['no-cross-panel-imports', widget('cross-panel.ts'), '@phoenix/admin/menu'],
        ['no-cross-panel-imports', widget('cross-panel.ts'), '../../../admin/app/menu'],
        ['no-tenant-literals', widget('tenant-literal.ts'), 'fixture-fa'],
        ['no-tenant-literals', widget('tenant-literal.ts'), 'Asia/Tehran'],
        [
          'panel-server-is-server-only',
          'packages/ui/src/server-import.ts',
          '@phoenix/panel-server',
        ],
      ].sort(),
    );
  });

  it('passes on the repository', () => {
    expect(run(REPO_ROOT)).toEqual({ code: 0, violations: [] });
  });
});
