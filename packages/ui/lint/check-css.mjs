// The CSS half of the UI lint rules (ESLint sees only JS/TS): no physical left/right properties
// and no raw colours in the stylesheets of packages/ui and the web apps. Token values live in
// src/tokens/panel-tokens.ts; the one stylesheet generated from it is the only exception.
// Usage: node packages/ui/lint/check-css.mjs [root]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../..'));
const DIRS = [
  'packages/ui/src',
  ...['admin', 'studio', 'portal'].flatMap((app) => [`apps/${app}/app`, `apps/${app}/src`]),
];
/** Generated from the token source and checked by tokens.spec.ts. */
const GENERATED = new Set(['packages/ui/src/tokens/tokens.css']);
const PHYSICAL =
  /(^|[\s;{])(margin|padding|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:|(text-align|float|clear)\s*:\s*(left|right)\b|border-(top|bottom)-(left|right)-radius/;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(/;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (file.endsWith('.css')) files.push(file);
  }
};
DIRS.map((dir) => path.join(root, dir)).forEach(
  (dir) => statSync(dir, { throwIfNoEntry: false }) && walk(dir),
);

const problems = [];
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const generated = GENERATED.has(relative);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const code = line.replace(/\/\*.*?\*\//g, '');
      if (PHYSICAL.test(code))
        problems.push(`${relative}:${index + 1}: logical-properties-only: ${line.trim()}`);
      if (!generated && COLOUR.test(code))
        problems.push(`${relative}:${index + 1}: tokens-only: ${line.trim()}`);
    });
}
console.log(`check-css: ${files.length} stylesheets, ${problems.length} problems`);
problems.forEach((p) => console.error(p));
process.exit(problems.length > 0 ? 1 : 0);
