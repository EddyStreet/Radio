import { describe, expect, it } from 'vitest';
import { composeEmail, composeSms } from '../src/compose.js';
import { AD_A as ad } from './fixtures.js';

describe('compose', () => {
  it('sms contains every field', () => {
    const t = composeSms(ad, 'KDEMO 101.5 FM');
    for (const s of ['Harbor Tire', 'Buy 3 tires', 'Code: RADIO4', ad.url, ad.phone, 'KDEMO 101.5 FM'])
      expect(t).toContain(s);
  });
  it('sms omits the code line when there is no promo code', () =>
    expect(composeSms({ ...ad, promoCode: undefined }, 'K')).not.toContain('Code:'));
  it('sms stays within 320 chars and keeps the url when the offer is huge', () => {
    const t = composeSms({ ...ad, offer: 'x'.repeat(1000) }, 'KDEMO 101.5 FM');
    expect(t.length).toBeLessThanOrEqual(320);
    expect(t).toContain(ad.url);
    expect(t).toContain('…');
  });
  it('email subject is advertiser: headline', () =>
    expect(composeEmail(ad, 'K', 0).subject).toBe('Harbor Tire: Winter tire sale'));
  it('email text carries fields, expiry and time heard', () => {
    const e = composeEmail(ad, 'KDEMO 101.5 FM', Date.UTC(2026, 10, 11, 15, 4));
    for (const s of [ad.offer, ad.url, ad.phone, 'RADIO4', '2026-12-31', 'KDEMO 101.5 FM'])
      expect(e.text).toContain(s);
    expect(e.text).toMatch(/Heard on KDEMO 101\.5 FM .*2026/);
  });
  it('email html escapes advertiser-supplied text', () =>
    expect(composeEmail({ ...ad, offer: '<b>50%</b> & more' }, 'K', 0).html).toContain(
      '&lt;b&gt;50%&lt;/b&gt; &amp; more',
    ));
});
