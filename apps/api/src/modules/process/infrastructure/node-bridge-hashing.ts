import { createHash } from 'node:crypto';
import type { BridgeHashing } from '../application/ports/bridge-hashing';

/** {@link BridgeHashing} on node:crypto's SHA-256. */
export class NodeBridgeHashing implements BridgeHashing {
  contentHash(text: string): string {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  }

  derivedId(parts: readonly string[]): string {
    // NUL never occurs in a tenant id, a kind or an engine id: the join is unambiguous.
    const bytes = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8 (RFC 9562)
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // the RFC 9562 variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
