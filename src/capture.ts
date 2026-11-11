import type { Schedule } from './schedule.js';
import type { AdAiring, Channel } from './types.js';

/** How long after an ad ends a press still counts as "this ad". */
export const GRACE_SECONDS = 30;

export type Resolution =
  | { ok: true; airing: AdAiring; late: boolean }
  | { ok: false; reason: 'no_ad' };

export function createCapture(schedule: Schedule) {
  const sent = new Set<string>();
  const key = (airing: AdAiring, channel: Channel) =>
    `${airing.ad.id}|${airing.startMs}|${channel}`;

  return {
    /**
     * Find the ad a press refers to. `now` means the ad on air, or one that
     * ended within the grace period. `last` means the most recent ad, however old.
     */
    resolve(pressedAtMs: number, mode: 'now' | 'last'): Resolution {
      const airing = schedule.lastAdBefore(pressedAtMs);
      if (!airing) return { ok: false, reason: 'no_ad' };
      const late = pressedAtMs >= airing.endMs;
      if (mode === 'now' && pressedAtMs - airing.endMs > GRACE_SECONDS * 1000) {
        return { ok: false, reason: 'no_ad' };
      }
      return { ok: true, airing, late };
    },
    alreadySent(airing: AdAiring, channel: Channel): boolean {
      return sent.has(key(airing, channel));
    },
    markSent(airing: AdAiring, channel: Channel): void {
      sent.add(key(airing, channel));
    },
    /** Release a claim after a failed delivery so the user can retry. */
    unmarkSent(airing: AdAiring, channel: Channel): void {
      sent.delete(key(airing, channel));
    },
  };
}

export type Capture = ReturnType<typeof createCapture>;
