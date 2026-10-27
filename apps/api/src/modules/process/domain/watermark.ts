import type { Temporal } from '@phoenix/shared-kernel';

/**
 * The engine sync's watermarks (PoC 3 R5): each pass asks the engine for what ended after the
 * last end time it saw, minus a margin for the engine's commit order and clock, so an end
 * written late is still read. The inbox makes the overlap harmless.
 */
export const WATERMARK_MARGIN_MS = 60_000;

/** The lower bound of the next query; `null` reads the whole history (a new tenant). */
export const queryFrom = (watermark: Temporal.Instant | null): Temporal.Instant | null =>
  watermark === null ? null : watermark.subtract({ milliseconds: WATERMARK_MARGIN_MS });

/** The watermark after a pass that read `ends`: never moves back. */
export function advance(
  watermark: Temporal.Instant | null,
  ends: readonly Temporal.Instant[],
): Temporal.Instant | null {
  let latest = watermark;
  for (const end of ends) {
    if (latest === null || end.epochMilliseconds > latest.epochMilliseconds) latest = end;
  }
  return latest;
}
