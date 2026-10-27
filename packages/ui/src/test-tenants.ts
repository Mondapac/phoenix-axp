// The two tenant fixtures of config/tenants/ (CLAUDE.md working rule 5: every test runs against
// at least two tenants with different locale, calendar and time zone). Specs only.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface TenantFixture {
  code: string;
  defaultLocale: string;
  supportedLocales: string[];
  timeZone: string;
  calendar: string;
  direction: 'ltr' | 'rtl';
}

const read = (code: string): TenantFixture =>
  JSON.parse(
    readFileSync(path.join(__dirname, '../../../config/tenants', `${code}.json`), 'utf8'),
  ) as TenantFixture;

export const TENANTS: TenantFixture[] = ['demo-fa', 'demo-en'].map(read);
