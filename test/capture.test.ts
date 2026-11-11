import { beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from '../src/capture.js';
import { createSchedule } from '../src/schedule.js';
import { EPOCH, LOG } from './fixtures.js';

let c: ReturnType<typeof createCapture>;
beforeEach(() => {
  c = createCapture(createSchedule(LOG, EPOCH));
});

describe('capture', () => {
  it('captures the ad airing now', () =>
    expect(c.resolve(1_025_000, 'now')).toMatchObject({ ok: true, late: false }));
  it('captures an ad that ended 30s ago', () =>
    expect(c.resolve(1_035_000 + 30_000, 'now')).toMatchObject({ ok: true, late: true }));
  it('does not capture an ad that ended 30.001s ago', () =>
    expect(c.resolve(1_035_000 + 30_001, 'now')).toEqual({ ok: false, reason: 'no_ad' }));
  it('reports no_ad before any ad has aired', () =>
    expect(c.resolve(1_005_000, 'now')).toEqual({ ok: false, reason: 'no_ad' }));
  it('last mode captures the most recent ad regardless of age', () =>
    expect(c.resolve(1_035_000 + 24_000, 'last')).toMatchObject({ ok: true }));
  it('last mode reports no_ad when none has aired', () =>
    expect(c.resolve(1_005_000, 'last')).toEqual({ ok: false, reason: 'no_ad' }));
  it('dedupes per airing and channel', () => {
    const r = c.resolve(1_025_000, 'now');
    if (!r.ok) throw new Error('expected an airing');
    expect(c.alreadySent(r.airing, 'sms')).toBe(false);
    c.markSent(r.airing, 'sms');
    expect(c.alreadySent(r.airing, 'sms')).toBe(true);
    expect(c.alreadySent(r.airing, 'email')).toBe(false);
  });
  it('does not dedupe the same ad in the next loop', () => {
    const a = c.resolve(1_025_000, 'now');
    const b = c.resolve(1_085_000, 'now');
    if (!a.ok || !b.ok) throw new Error('expected airings');
    c.markSent(a.airing, 'sms');
    expect(c.alreadySent(b.airing, 'sms')).toBe(false);
  });
});
