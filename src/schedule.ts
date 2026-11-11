import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdAiring, Airing, LogItem } from './types.js';

export const STATION_NAME = 'KDEMO 101.5 FM';

export interface Schedule {
  /** The item on air at `timeMs`. Item end times are exclusive. */
  itemAt(timeMs: number): Airing;
  /** The most recent ad airing that started at or before `timeMs`, if any has aired. */
  lastAdBefore(timeMs: number): AdAiring | null;
}

const AD_FIELDS = ['id', 'advertiser', 'headline', 'offer', 'url', 'phone'] as const;

/** Throws a message naming the entry and field if a broadcast log is malformed. */
export function assertValidLog(log: unknown): asserts log is LogItem[] {
  if (!Array.isArray(log) || log.length === 0) {
    throw new Error('Broadcast log must be a non-empty list');
  }
  log.forEach((entry: unknown, index) => {
    const fail = (field: string): never => {
      throw new Error(`Broadcast log entry ${index + 1}: missing or invalid "${field}"`);
    };
    const item = (entry ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
    if (typeof item.durationSec !== 'number' || !(item.durationSec > 0)) fail('durationSec');
    if (item.kind === 'song') {
      if (!text(item.title)) fail('title');
      if (!text(item.artist)) fail('artist');
    } else if (item.kind === 'ad') {
      const ad = (item.ad ?? {}) as Record<string, unknown>;
      for (const field of AD_FIELDS) if (!text(ad[field])) fail(field);
      for (const field of ['promoCode', 'expires']) {
        if (ad[field] !== undefined && !text(ad[field])) fail(field);
      }
    } else {
      fail('kind');
    }
  });
}

export function loadBroadcastLog(): LogItem[] {
  const path = fileURLToPath(new URL('./data/broadcast-log.json', import.meta.url));
  const log: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assertValidLog(log);
  return log;
}

/** A broadcast log that loops forever starting at `epochMs`. */
export function createSchedule(log: LogItem[], epochMs: number): Schedule {
  if (log.length === 0) throw new Error('Broadcast log is empty');
  const offsets: number[] = [];
  let loopMs = 0;
  for (const item of log) {
    offsets.push(loopMs);
    loopMs += item.durationSec * 1000;
  }
  if (loopMs <= 0) throw new Error('Broadcast log has no duration');

  function airing(loop: number, index: number): Airing {
    const startMs = epochMs + loop * loopMs + offsets[index];
    return { item: log[index], startMs, endMs: startMs + log[index].durationSec * 1000 };
  }

  function locate(timeMs: number): { loop: number; index: number } {
    const elapsed = Math.max(0, timeMs - epochMs);
    const loop = Math.floor(elapsed / loopMs);
    const within = elapsed - loop * loopMs;
    let index = log.length - 1;
    while (offsets[index] > within) index--;
    return { loop, index };
  }

  return {
    itemAt(timeMs) {
      const { loop, index } = locate(timeMs);
      return airing(loop, index);
    },
    lastAdBefore(timeMs) {
      if (timeMs < epochMs) return null;
      let { loop, index } = locate(timeMs);
      // Walk backwards at most one full loop.
      for (let step = 0; step < log.length; step++) {
        if (loop < 0) return null;
        const item = log[index];
        if (item.kind === 'ad') {
          const a = airing(loop, index);
          return { ad: item.ad, startMs: a.startMs, endMs: a.endMs };
        }
        index--;
        if (index < 0) {
          index = log.length - 1;
          loop--;
        }
      }
      return null;
    },
  };
}
