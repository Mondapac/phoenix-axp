import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Violation: a module's infrastructure uses the ObjectStore port, never the AWS SDK.
export const violation = getSignedUrl;
