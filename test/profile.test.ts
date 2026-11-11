import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProfileStore, validateProfile } from '../src/profile.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'radio-')), 'nested', 'profile.json');

describe('profile', () => {
  it('accepts a phone-only profile and defaults to sms', () =>
    expect(validateProfile({ phone: '+15555550100' })).toEqual({
      ok: true,
      profile: { phone: '+15555550100', defaultChannels: ['sms'] },
    }));
  it('accepts an email-only profile and defaults to email', () =>
    expect(validateProfile({ email: 'a@example.com', phone: '' })).toEqual({
      ok: true,
      profile: { email: 'a@example.com', defaultChannels: ['email'] },
    }));
  it('trims surrounding whitespace', () =>
    expect(validateProfile({ phone: ' +15555550100 ' })).toMatchObject({
      profile: { phone: '+15555550100' },
    }));
  it('rejects a non-E.164 phone', () => {
    const r = validateProfile({ phone: '555-0142' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phone).toBeTruthy();
  });
  it('rejects a malformed email', () => {
    const r = validateProfile({ email: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email).toBeTruthy();
  });
  it('rejects a profile with neither contact', () => expect(validateProfile({}).ok).toBe(false));
  it('rejects a non-object', () => expect(validateProfile(null).ok).toBe(false));
  it('rejects default sms when no phone is saved', () => {
    const r = validateProfile({ email: 'a@example.com', defaultChannels: ['sms'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.defaultChannels).toBeTruthy();
  });
  it('rejects an unknown channel name', () => {
    const r = validateProfile({ phone: '+15555550100', defaultChannels: ['fax'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.defaultChannels).toBeTruthy();
  });
  it('rejects an empty channel list', () =>
    expect(validateProfile({ phone: '+15555550100', defaultChannels: [] }).ok).toBe(false));
  it('persists and reloads from disk', () => {
    const file = tmpFile();
    const profile = { phone: '+15555550100', defaultChannels: ['sms' as const] };
    createProfileStore(file).save(profile);
    expect(createProfileStore(file).get()).toEqual(profile);
  });
  it('returns null when the file is missing', () => expect(createProfileStore(tmpFile()).get()).toBeNull());
  it('returns null when the file is corrupt json', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'radio-')), 'profile.json');
    writeFileSync(file, '{not json');
    expect(createProfileStore(file).get()).toBeNull();
  });
  it('returns null when the file holds an invalid profile', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'radio-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ phone: 'nope' }));
    expect(createProfileStore(file).get()).toBeNull();
  });
});
