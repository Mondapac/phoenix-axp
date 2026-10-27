import type { StorageConfig } from '../config/app-config';
import type { ObjectKey } from './object-key';
import {
  MAX_SIGNED_URL_SECONDS,
  StorageUnavailableError,
  UnconfiguredObjectStore,
} from './object-store';
import { attachment, S3ObjectStore } from './s3-object-store';

const CONFIG: StorageConfig = {
  endpoint: 'http://seaweedfs:8333',
  publicEndpoint: 'https://files.example.test',
  region: 'us-east-1',
  bucket: 'phoenix',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
};
const KEY = 'acme-gov/forms/0192f1a0-0000-7000-8000-000000000001' as ObjectKey;

describe('S3ObjectStore.signedDownloadUrl (no network: signing is local)', () => {
  const store = new S3ObjectStore(CONFIG);
  afterAll(() => store.destroy());

  it('signs for the public endpoint, path style, as an attachment, for the given time', async () => {
    const url = new URL(
      await store.signedDownloadUrl(KEY, { expiresInSeconds: 300, fileName: 'نامه.pdf' }),
    );

    expect(url.origin).toBe('https://files.example.test');
    expect(url.pathname).toBe(`/phoenix/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe(attachment('نامه.pdf'));
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([0, -1, 1.5, MAX_SIGNED_URL_SECONDS + 1])(
    'refuses an expiry of %p seconds',
    (expiresInSeconds) => {
      expect(() => store.signedDownloadUrl(KEY, { expiresInSeconds })).toThrow(RangeError);
    },
  );
});

describe('attachment', () => {
  it('is a bare attachment without a name', () => {
    expect(attachment()).toBe('attachment');
  });

  it('adds an ASCII fallback and the RFC 5987 UTF-8 name', () => {
    expect(attachment('نامه‌ها (1).pdf')).toBe(
      'attachment; filename="_______ (1).pdf"; ' +
        "filename*=UTF-8''%D9%86%D8%A7%D9%85%D9%87%E2%80%8C%D9%87%D8%A7%20%281%29.pdf",
    );
  });

  it('cannot break out of the quoted fallback', () => {
    expect(attachment('a"; filename="evil.html')).toBe(
      'attachment; filename="a_; filename=_evil.html"; ' +
        "filename*=UTF-8''a%22%3B%20filename%3D%22evil.html",
    );
  });
});

describe('UnconfiguredObjectStore', () => {
  const store = new UnconfiguredObjectStore();

  it('fails every call closed', async () => {
    await expect(store.put()).rejects.toThrow(StorageUnavailableError);
    await expect(store.get()).rejects.toThrow(StorageUnavailableError);
    await expect(store.delete()).rejects.toThrow(StorageUnavailableError);
    await expect(store.signedDownloadUrl()).rejects.toThrow(StorageUnavailableError);
  });
});
