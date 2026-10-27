// Writes src/tokens/tokens.css from src/tokens/panel-tokens.ts (Node's own TypeScript support).
// Usage: pnpm --filter @phoenix/ui tokens
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tokensStylesheet } from '../src/tokens/panel-tokens.ts';

const target = path.join(import.meta.dirname, '../src/tokens/tokens.css');
writeFileSync(target, tokensStylesheet());
console.log(`wrote ${path.relative(process.cwd(), target)}`);
