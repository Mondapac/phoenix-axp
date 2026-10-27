// SPIKE (PoC 2): a use case's failure as an HTTP error. A gate denial maps by its code
// (401/403/503); a domain failure (a string code) maps through the controller's table.
import { HttpException } from '@nestjs/common';
import { ACCESS_DENIED_STATUS, type AccessDenied } from './access-denied';

export function httpFailure<F extends string>(
  error: AccessDenied | F,
  statuses: Readonly<Record<F, number>>,
): HttpException {
  if (typeof error === 'string') {
    const status = statuses[error];
    return new HttpException({ statusCode: status, code: error }, status);
  }
  const status = ACCESS_DENIED_STATUS[error.code];
  return new HttpException({ statusCode: status, code: error.code }, status);
}
