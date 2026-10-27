import { S3Client } from '@aws-sdk/client-s3';

// Allowed: the S3 adapter of platform/storage/ is the one user of the AWS SDK.
export const allowed = S3Client;
