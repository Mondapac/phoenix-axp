import { createHash } from 'node:crypto';
import type { ContentHasher } from '../application/ports/collaborators';

/** Canonical JSON: object keys sorted at every level, so equal content hashes equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 hashes and derived ids (RFC 9562 version 8 layout, name-based on SHA-256). */
export class NodeContentHasher implements ContentHasher {
  hashOf(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  }

  derivedId(parts: readonly string[]): string {
    const bytes = createHash('sha256').update(parts.join('\u0000')).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
