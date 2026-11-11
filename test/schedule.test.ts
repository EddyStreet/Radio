import { describe, expect, it } from 'vitest';
import { assertValidLog, createSchedule, loadBroadcastLog } from '../src/schedule.js';
import { EPOCH, LOG } from './fixtures.js';

const s = createSchedule(LOG, EPOCH);

describe('schedule', () => {
  it('returns the song at the start', () => expect(s.itemAt(1_000_000).item.kind).toBe('song'));
  it('returns the ad with its airing bounds', () => {
    const a = s.itemAt(1_000_000 + 25_000);
    expect(a.item.kind).toBe('ad');
    expect(a.startMs).toBe(1_020_000);
    expect(a.endMs).toBe(1_035_000);
  });
  it('treats an item end as exclusive', () => expect(s.itemAt(1_035_000).item.kind).toBe('song'));
  it('wraps around the loop', () =>
    expect(s.itemAt(1_000_000 + 60_000 + 25_000).startMs).toBe(1_080_000));
  it('finds the last ad before a time in a later song', () =>
    expect(s.lastAdBefore(1_040_000)).toMatchObject({ startMs: 1_020_000, endMs: 1_035_000 }));
  it("finds the previous loop's ad when none has aired yet this loop", () =>
    expect(s.lastAdBefore(1_060_000 + 5_000)!.startMs).toBe(1_020_000));
  it('returns null before any ad has ever aired', () => expect(s.lastAdBefore(1_005_000)).toBeNull());
  it('returns the current ad from lastAdBefore while it airs', () =>
    expect(s.lastAdBefore(1_025_000)!.startMs).toBe(1_020_000));
  it('loads the bundled log with at least one ad', () =>
    expect(loadBroadcastLog().some((i) => i.kind === 'ad')).toBe(true));

  it('accepts a well-formed log', () => expect(() => assertValidLog(LOG)).not.toThrow());
  it('rejects an ad with a missing field, naming the entry and field', () => {
    const bad = [{ kind: 'ad', durationSec: 15, ad: { id: 'x', advertiser: 'A', headline: 'H', offer: 'O', url: 'https://example.com' } }];
    expect(() => assertValidLog(bad)).toThrow(/entry 1.*phone/);
  });
  it('rejects an entry with no positive duration', () =>
    expect(() => assertValidLog([{ kind: 'song', title: 'T', artist: 'A', durationSec: 0 }])).toThrow(/entry 1.*durationSec/));
  it('rejects a log that is not a non-empty list', () => {
    expect(() => assertValidLog([])).toThrow();
    expect(() => assertValidLog({})).toThrow();
  });
});
