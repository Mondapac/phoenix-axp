import { appendFileSync } from 'node:fs';

/** Appends one JSON line per scenario to POC_RESULTS_FILE, the raw data of the report. */
export function record(scenario: string, data: Record<string, unknown>): void {
  const file = process.env.POC_RESULTS_FILE;
  if (file) appendFileSync(file, JSON.stringify({ scenario, ...data }) + '\n');
}
