/**
 * The hashing the bridge needs, done outside any unit (CLAUDE.md: no hashing inside a unit).
 */
export interface BridgeHashing {
  /** `sha256:` and the hex SHA-256 of the UTF-8 text. */
  contentHash(text: string): string;
  /**
   * A UUID derived from `parts` (version 8, from their SHA-256): the same observation of the
   * engine always gets the same event id, on any pass and any worker (PoC 3, section 3).
   */
  derivedId(parts: readonly string[]): string;
}

/** Nest token of the {@link BridgeHashing} port. */
export const BRIDGE_HASHING = Symbol('BRIDGE_HASHING');
