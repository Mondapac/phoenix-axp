import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventDescription } from '@phoenix/shared-kernel';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventCatalogue, compareWithSnapshot } from '../../src/platform/events/event-catalogue';
import { SubscriptionRegistry } from '../../src/platform/events/event-subscriptions';
import { createTestApp } from '../support/test-app';

// The contract of ADR-0006 (P 5.3), ported in shape from Mondapac's event catalogue contract:
// the events the booted application registers equal the checked-in snapshot, so a new type, or
// a changed field list, is read in review (the security review reads every payload: ids, codes
// and numbers only). It arrived with forms.submission-received.v1, the first business event
// (slice 2.6).

const SNAPSHOT = path.join(__dirname, 'event-catalogue.snapshot.json');

describe('the event catalogue (contract)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('is sealed at bootstrap and equals the checked-in snapshot', () => {
    const catalogue = app.get(EventCatalogue);
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as EventDescription[];

    expect(catalogue.sealed).toBe(true);
    expect(compareWithSnapshot(catalogue.snapshot(), snapshot)).toEqual([]);
  });

  it('subscribes the process module to the submissions of forms', () => {
    expect(app.get(SubscriptionRegistry).subscribersOf('forms.submission-received.v1')).toEqual([
      'process.start-from-submission',
    ]);
  });
});
