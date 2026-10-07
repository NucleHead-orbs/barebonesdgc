/**
 * Handing the scoring phone around the card (Jewel tradition). Rules:
 *  - The card's QR (/c/:token) IS the scorecard: any phone that opens it can score, and the last tap on a hole wins.
 *    Nothing on the server changes hands, so a handoff never needs the TD and can't lock anyone out.
 *  - Before handing off, every tap on this phone has to reach the server, or the next scorer won't see it.
 *  - The phone that handed off goes watch-only (this phone only) so two people don't score the same hole.
 *    "Take the card back" undoes it. A phone that never used the button keeps working exactly as before.
 */
export const handoffKey = (token: string) => `bb-card-handed-${token}`;
export const handoffUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/c/${token}?handoff=1`;

export type HandoffStep = 'syncing' | 'unsynced' | 'ready';
/** What the handoff sheet shows: still trying, taps stuck on this phone, or the QR. */
export function handoffStep(o: { checking: boolean; pending: number }): HandoffStep {
  if (o.checking) return 'syncing';
  return o.pending > 0 ? 'unsynced' : 'ready';
}

/** "Thru 7" style progress for the person taking over: holes everyone has a score on. */
export function holesDone(holeNumbers: number[], playerIds: string[], scores: Record<string, Record<number, number>>): number {
  if (!playerIds.length) return 0;
  return holeNumbers.filter((h) => playerIds.every((p) => scores[p]?.[h] != null)).length;
}
