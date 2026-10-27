import { randomBytes } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Temporal } from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator, testTenantContext } from '@phoenix/shared-kernel/testing';
import type { StorageConfig } from '../../src/platform/config/app-config';
import { ConfigModule } from '../../src/platform/config/config.module';
import { objectKey } from '../../src/platform/storage/object-key';
import { OBJECT_STORE } from '../../src/platform/storage/object-store';
import type { ObjectStore } from '../../src/platform/storage/object-store';
import { S3ObjectStore } from '../../src/platform/storage/s3-object-store';
import { MALWARE_SCANNER } from '../../src/platform/storage/file-intake';
import {
  MalwareScannerRequiredError,
  StorageModule,
} from '../../src/platform/storage/storage.module';
import { testAppConfig } from '../support/test-config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for pnpm test:storage`);
  return value;
}

/** A fresh bucket name per call, so runs and specs never share state. */
const freshBucket = (): string => `phoenix-test-${randomBytes(6).toString('hex')}`;

const STORAGE_ENV = {
  S3_ENDPOINT: required('S3_ENDPOINT'),
  S3_ACCESS_KEY_ID: required('S3_ACCESS_KEY_ID'),
  S3_SECRET_ACCESS_KEY: required('S3_SECRET_ACCESS_KEY'),
};

const ids = new SequenceIdGenerator(new FixedClock(Temporal.Instant.from('2026-10-27T10:00:00Z')));
const tenantA = testTenantContext('tenant-a');
const tenantB = testTenantContext('tenant-b');

function storageConfig(bucket: string): StorageConfig {
  const { storage } = testAppConfig({ ...STORAGE_ENV, S3_BUCKET: bucket });
  if (storage === null) throw new Error('storage config expected');
  return storage;
}

describe('S3ObjectStore against SeaweedFS', () => {
  let store: S3ObjectStore;

  beforeAll(async () => {
    store = new S3ObjectStore(storageConfig(freshBucket()));
    await store.ensureBucket(true);
  });
  afterAll(() => store.destroy());

  it('stores and returns the bytes', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    const body = Uint8Array.from(randomBytes(64 * 1024));

    await store.put(key, body, 'application/pdf');

    expect(Buffer.from((await store.get(key)) ?? []).equals(Buffer.from(body))).toBe(true);
  });

  it('answers null for a missing object', async () => {
    expect(await store.get(objectKey(tenantA, 'forms', ids.next()))).toBeNull();
  });

  it('keeps two tenants apart under the same module and id', async () => {
    const id = ids.next();
    await store.put(objectKey(tenantA, 'forms', id), Buffer.from('a'), 'text/plain');

    expect(await store.get(objectKey(tenantB, 'forms', id))).toBeNull();
  });

  it('deletes, and deleting again succeeds', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('x'), 'text/plain');

    await store.delete(key);
    await store.delete(key);

    expect(await store.get(key)).toBeNull();
  });

  it('serves a signed URL as an attachment with the stored content type', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('%PDF-1.7\n'), 'application/pdf');

    const answer = await fetch(
      await store.signedDownloadUrl(key, { expiresInSeconds: 60, fileName: 'نامه.pdf' }),
    );

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('application/pdf');
    expect(answer.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(await answer.text()).toBe('%PDF-1.7\n');
  });

  it('refuses a signed URL whose key was changed', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('secret'), 'text/plain');
    const other = objectKey(tenantB, 'forms', ids.next());
    await store.put(other, Buffer.from('other tenant'), 'text/plain');

    const url = await store.signedDownloadUrl(key, { expiresInSeconds: 60 });
    const answer = await fetch(url.replace(key, other));

    expect(answer.status).toBe(403);
  });

  it('refuses an expired signed URL', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('secret'), 'text/plain');

    const url = await store.signedDownloadUrl(key, { expiresInSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    expect((await fetch(url)).status).toBe(403);
  });

  it('refuses a signed URL whose Content-Disposition was changed to inline', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('<script>alert(1)</script>'), 'text/plain');

    const url = new URL(await store.signedDownloadUrl(key, { expiresInSeconds: 60 }));
    url.searchParams.set('response-content-disposition', 'inline');

    expect((await fetch(url)).status).toBe(403);
  });

  it('refuses an unsigned request', async () => {
    const key = objectKey(tenantA, 'forms', ids.next());
    await store.put(key, Buffer.from('secret'), 'text/plain');

    const url = new URL(await store.signedDownloadUrl(key, { expiresInSeconds: 60 }));

    expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403);
  });
});

describe('StorageModule', () => {
  /** A scanner bound the way a deployment binds one: a global module exporting the token. */
  @Global()
  @Module({
    providers: [{ provide: MALWARE_SCANNER, useValue: { scan: () => Promise.resolve('clean') } }],
    exports: [MALWARE_SCANNER],
  })
  class CleanScannerModule {}

  /** `production` sets nodeEnv after loading, so the local key and http endpoint still load. */
  async function initModule(
    env: Record<string, string>,
    options: { production?: boolean; scanner?: boolean } = {},
  ): Promise<{ store: ObjectStore; close: () => Promise<void> }> {
    const config = testAppConfig(env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(options.production ? { ...config, nodeEnv: 'production' } : config),
        StorageModule,
        ...(options.scanner ? [CleanScannerModule] : []),
      ],
    }).compile();
    await moduleRef.init();
    return { store: moduleRef.get(OBJECT_STORE), close: () => moduleRef.close() };
  }

  it('binds the S3 store and creates a missing bucket outside production', async () => {
    const bucket = freshBucket();
    const { store, close } = await initModule({ ...STORAGE_ENV, S3_BUCKET: bucket });
    try {
      expect(store).toBeInstanceOf(S3ObjectStore);
      const key = objectKey(tenantA, 'forms', ids.next());
      await store.put(key, Buffer.from('ok'), 'text/plain');
      expect(await store.get(key)).not.toBeNull();
    } finally {
      await close();
    }
  });

  it('refuses to start in production without a malware scanner', async () => {
    await expect(
      initModule({ ...STORAGE_ENV, S3_BUCKET: freshBucket() }, { production: true }),
    ).rejects.toThrow(MalwareScannerRequiredError);
  });

  it('refuses to start in production when the bucket is missing', async () => {
    await expect(
      initModule({ ...STORAGE_ENV, S3_BUCKET: freshBucket() }, { production: true, scanner: true }),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });
});
