import { S3Client } from '@aws-sdk/client-s3';

// Violation: only platform/storage/ uses the AWS SDK; everything else uses the ObjectStore port.
export const violation = S3Client;
