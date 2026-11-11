import type { Ad, LogItem } from '../src/types.js';

export const EPOCH = 1_000_000;

export const AD_A: Ad = {
  id: 'a1',
  advertiser: 'Harbor Tire',
  headline: 'Winter tire sale',
  offer: 'Buy 3 tires, get the 4th free',
  url: 'https://example.com/harbor',
  phone: '+15555550142',
  promoCode: 'RADIO4',
  expires: '2026-12-31',
};

/** song 20s, ad A 15s, song 25s — a 60 second loop. */
export const LOG: LogItem[] = [
  { kind: 'song', title: 'One', artist: 'First', durationSec: 20 },
  { kind: 'ad', durationSec: 15, ad: AD_A },
  { kind: 'song', title: 'Two', artist: 'Second', durationSec: 25 },
];
