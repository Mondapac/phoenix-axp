import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '../config/app-config';
import type { ObjectKey } from './object-key';
import { MAX_SIGNED_URL_SECONDS } from './object-store';
import type { ObjectStore, SignedDownloadOptions } from './object-store';

/**
 * The ObjectStore adapter for the S3 API (ADR-0012): SeaweedFS in compose and on-prem, any
 * S3-compatible store elsewhere. The AWS SDK is used in this folder only.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  /** Signs URLs for the host browsers reach, which may differ from the API's. */
  private readonly signer: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = clientFor(config, config.endpoint);
    this.signer = clientFor(config, config.publicEndpoint);
  }

  /**
   * Checks the bucket at start-up. A missing bucket is created outside production; in
   * production it stops the start, since buckets are provisioned with the deployment.
   */
  async ensureBucket(createIfMissing: boolean): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (error) {
      if (!(error instanceof NotFound) || !createIfMissing) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }

  async put(key: ObjectKey, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: ObjectKey): Promise<Uint8Array | null> {
    try {
      const answer = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return answer.Body ? await answer.Body.transformToByteArray() : new Uint8Array();
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: ObjectKey): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  signedDownloadUrl(key: ObjectKey, options: SignedDownloadOptions): Promise<string> {
    const seconds = options.expiresInSeconds;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SIGNED_URL_SECONDS) {
      throw new RangeError(
        `expiresInSeconds must be an integer from 1 to ${MAX_SIGNED_URL_SECONDS}`,
      );
    }
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentDisposition: attachment(options.fileName),
    });
    return getSignedUrl(this.signer, command, { expiresIn: seconds });
  }

  destroy(): void {
    this.client.destroy();
    this.signer.destroy();
  }
}

function clientFor(config: StorageConfig, endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Bucket in the path: SeaweedFS and most on-prem stores have no wildcard DNS.
    forcePathStyle: true,
    // Checksums only where the S3 API requires them; not every S3-compatible store accepts
    // the SDK's default CRC32 headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * `attachment`, never `inline`: a stored file is not rendered on the store's origin. The
 * name goes in RFC 6266 form, an ASCII fallback plus the UTF-8 name for Persian names.
 */
export function attachment(fileName?: string): string {
  if (fileName === undefined) return 'attachment';
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
