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

export function loadBroadcastLog(): LogItem[] {
  const path = fileURLToPath(new URL('./data/broadcast-log.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as LogItem[];
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
