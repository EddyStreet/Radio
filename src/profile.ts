import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Channel, Profile } from './types.js';

export type ProfileErrors = Partial<Record<'phone' | 'email' | 'defaultChannels', string>>;

const PHONE = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function validateProfile(
  input: unknown,
): { ok: true; profile: Profile } | { ok: false; errors: ProfileErrors } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: ProfileErrors = {};
  const phone = clean(raw.phone);
  const email = clean(raw.email);

  if (phone && !PHONE.test(phone)) {
    errors.phone = 'Use international format, for example +15555550100';
  }
  if (email && !EMAIL.test(email)) {
    errors.email = 'Enter a valid email address';
  }
  if (!phone && !email) {
    errors.phone = 'Add a mobile number or an email address';
  }

  let defaultChannels: Channel[];
  if (raw.defaultChannels === undefined) {
    defaultChannels = phone ? ['sms'] : ['email'];
  } else if (
    Array.isArray(raw.defaultChannels) &&
    raw.defaultChannels.length > 0 &&
    raw.defaultChannels.every((c) => c === 'sms' || c === 'email')
  ) {
    defaultChannels = [...new Set(raw.defaultChannels as Channel[])];
    if (defaultChannels.includes('sms') && !phone) {
      errors.defaultChannels = 'Add a mobile number to send by text';
    } else if (defaultChannels.includes('email') && !email) {
      errors.defaultChannels = 'Add an email address to send by email';
    }
  } else {
    defaultChannels = [];
    errors.defaultChannels = 'Choose text, email or both';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: { ...(phone ? { phone } : {}), ...(email ? { email } : {}), defaultChannels },
  };
}

/** A single saved profile, kept in a JSON file on this machine. */
export function createProfileStore(filePath: string) {
  let cached: Profile | null | undefined;
  return {
    get(): Profile | null {
      if (cached !== undefined) return cached;
      try {
        const result = validateProfile(JSON.parse(readFileSync(filePath, 'utf8')));
        cached = result.ok ? result.profile : null;
      } catch {
        cached = null; // Missing or unreadable file means no profile yet.
      }
      return cached;
    },
    save(profile: Profile): void {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(profile, null, 2));
      cached = profile;
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
