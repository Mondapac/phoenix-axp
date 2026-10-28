'use client';
import type { ApiAnswer } from '../_lib/api-answer';

// The screens' writes: a same-origin call of the studio's BFF relay (`/api/<route>`), with the
// session's CSRF token. The browser reaches nothing else (check-panel-boundaries).

export async function callApi<T = unknown>(
  method: 'POST' | 'PUT' | 'DELETE',
  route: string,
  csrfToken: string,
  body?: unknown,
): Promise<ApiAnswer<T>> {
  const response = await fetch(`/api/${route}`, {
    method,
    headers: {
      'x-csrf-token': csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => null);
  if (response === null) return { ok: false, status: 0, code: null };
  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    // A body that is not JSON carries no code.
  }
  if (response.ok) return { ok: true, body: parsed as T };
  const code =
    typeof parsed === 'object' &&
    parsed !== null &&
    'code' in parsed &&
    typeof parsed.code === 'string'
      ? parsed.code
      : null;
  return { ok: false, status: response.status, code };
}
