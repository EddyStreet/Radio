import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createCapture } from '../src/capture.js';
import { createProfileStore } from '../src/profile.js';
import { createSchedule } from '../src/schedule.js';
import type { Channel, DeliveryResult, OutboundMessage, Provider } from '../src/types.js';
import { EPOCH, LOG } from './fixtures.js';

const SONG_1 = EPOCH + 5_000;
const IN_AD = EPOCH + 25_000;
const AFTER_AD = EPOCH + 40_000; // 5s after the ad ended
const LONG_AFTER_AD = EPOCH + 35_000 + 31_000;

let now: number;
let sentMessages: OutboundMessage[];
let failing: Set<Channel>;
let app: ReturnType<typeof createApp>;

function stub(channel: Channel): Provider {
  return {
    live: channel === 'email',
    async send(message): Promise<DeliveryResult> {
      if (failing.has(channel)) return { channel, status: 'failed', detail: 'vendor said no' };
      sentMessages.push(message);
      return { channel, status: 'sent', detail: 'id-1' };
    },
  };
}

beforeEach(() => {
  now = SONG_1;
  sentMessages = [];
  failing = new Set();
  const dir = mkdtempSync(join(tmpdir(), 'radio-app-'));
  writeFileSync(join(dir, 'index.html'), '<h1>car screen</h1>');
  const schedule = createSchedule(LOG, EPOCH);
  app = createApp({
    schedule,
    capture: createCapture(schedule),
    providers: { sms: stub('sms'), email: stub('email') },
    profiles: createProfileStore(join(dir, 'profile.json')),
    now: () => now,
    station: 'KTEST',
    publicDir: dir,
  });
});

const saveProfile = (body: object = { phone: '+15555550100' }) =>
  request(app).put('/api/profile').send(body);
const press = (body: object) => request(app).post('/api/capture').send(body);
const pressNow = (extra: object = {}) =>
  press({ pressedAt: now, mode: 'now', trigger: 'touch', ...extra });

describe('GET /api/now-playing', () => {
  it('reports a song', async () => {
    const res = await request(app).get('/api/now-playing');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      station: 'KTEST',
      serverTimeMs: SONG_1,
      item: { kind: 'song', title: 'One', artist: 'First' },
      startMs: EPOCH,
      endMs: EPOCH + 20_000,
      recentAd: null,
    });
  });
  it('reports an ad with advertiser and headline only', async () => {
    now = IN_AD;
    const res = await request(app).get('/api/now-playing');
    expect(res.body.item).toEqual({
      kind: 'ad',
      ad: { advertiser: 'Harbor Tire', headline: 'Winter tire sale' },
    });
    expect(res.body.recentAd).toBeNull();
  });
  it('exposes recentAd for 30s after an ad ends', async () => {
    now = EPOCH + 35_000 + 30_000;
    const res = await request(app).get('/api/now-playing');
    expect(res.body.recentAd).toEqual({
      advertiser: 'Harbor Tire',
      headline: 'Winter tire sale',
      endedMs: EPOCH + 35_000,
    });
  });
  it('drops recentAd after the grace period', async () => {
    now = LONG_AFTER_AD;
    expect((await request(app).get('/api/now-playing')).body.recentAd).toBeNull();
  });
  it('reports whether any ad has aired yet', async () => {
    expect((await request(app).get('/api/now-playing')).body.hasLastAd).toBe(false);
    now = LONG_AFTER_AD;
    expect((await request(app).get('/api/now-playing')).body.hasLastAd).toBe(true);
  });
});

describe('profile', () => {
  it('starts empty and reports live flags', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.body).toEqual({ profile: null, live: { sms: false, email: true } });
  });
  it('round-trips a saved profile', async () => {
    expect((await saveProfile()).status).toBe(200);
    expect((await request(app).get('/api/profile')).body.profile).toEqual({
      phone: '+15555550100',
      defaultChannels: ['sms'],
    });
  });
  it('returns 400 with field errors', async () => {
    const res = await saveProfile({ phone: '555' });
    expect(res.status).toBe(400);
    expect(res.body.errors.phone).toBeTruthy();
  });
});

describe('POST /api/capture', () => {
  it('without a profile is 409 no_contact', async () => {
    now = IN_AD;
    const res = await pressNow();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'no_contact' });
  });

  it('during an ad sends by the default channel and logs the message', async () => {
    await saveProfile();
    now = IN_AD;
    const res = await pressNow();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      outcome: 'sent',
      ad: { advertiser: 'Harbor Tire', headline: 'Winter tire sale' },
      late: false,
      results: [{ channel: 'sms', status: 'sent', detail: 'id-1' }],
    });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({ channel: 'sms', to: '+15555550100' });
    expect(sentMessages[0].text).toContain('https://example.com/harbor');

    const log = (await request(app).get('/api/messages')).body.messages;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      trigger: 'touch',
      advertiser: 'Harbor Tire',
      channel: 'sms',
      to: '+15555550100',
      status: 'sent',
      atMs: IN_AD,
    });
  });

  it('a late press inside the grace period is sent and marked late', async () => {
    await saveProfile();
    now = AFTER_AD;
    expect((await pressNow()).body).toMatchObject({ outcome: 'sent', late: true });
  });

  it('with channel email sends only email, with subject and html', async () => {
    await saveProfile({ phone: '+15555550100', email: 'd@example.com' });
    now = IN_AD;
    const res = await pressNow({ channel: 'email', trigger: 'voice' });
    expect(res.body.results).toEqual([{ channel: 'email', status: 'sent', detail: 'id-1' }]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      channel: 'email',
      to: 'd@example.com',
      subject: 'Harbor Tire: Winter tire sale',
    });
    expect(sentMessages[0].html).toContain('Harbor Tire');
  });

  it('sends both when both are the default', async () => {
    await saveProfile({
      phone: '+15555550100',
      email: 'd@example.com',
      defaultChannels: ['sms', 'email'],
    });
    now = IN_AD;
    const res = await pressNow({ trigger: 'button' });
    expect(res.body.results.map((r: DeliveryResult) => r.channel).sort()).toEqual(['email', 'sms']);
  });

  it('with a channel that has no contact is 409 missing_contact', async () => {
    await saveProfile();
    now = IN_AD;
    const res = await pressNow({ channel: 'email' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'missing_contact', channel: 'email' });
    expect(sentMessages).toHaveLength(0);
  });

  it('during a song is no_ad and sends nothing', async () => {
    await saveProfile();
    const res = await pressNow();
    expect(res.body).toEqual({ outcome: 'no_ad' });
    expect(sentMessages).toHaveLength(0);
  });

  it('in last mode during a song sends the previous ad', async () => {
    await saveProfile();
    now = LONG_AFTER_AD;
    expect((await pressNow()).body).toEqual({ outcome: 'no_ad' });
    const res = await press({ pressedAt: now, mode: 'last', trigger: 'touch' });
    expect(res.body).toMatchObject({ outcome: 'sent', ad: { advertiser: 'Harbor Tire' } });
  });

  it('a second capture of the same airing is already_sent', async () => {
    await saveProfile();
    now = IN_AD;
    await pressNow();
    const res = await pressNow();
    expect(res.body).toEqual({
      outcome: 'already_sent',
      ad: { advertiser: 'Harbor Tire', headline: 'Winter tire sale' },
    });
    expect(sentMessages).toHaveLength(1);
  });

  it('reports sms failure and email success; a retry resends only sms', async () => {
    await saveProfile({
      phone: '+15555550100',
      email: 'd@example.com',
      defaultChannels: ['sms', 'email'],
    });
    now = IN_AD;
    failing.add('sms');
    const first = await pressNow();
    expect(first.body.outcome).toBe('sent');
    expect(first.body.results).toEqual(
      expect.arrayContaining([
        { channel: 'sms', status: 'failed', detail: 'vendor said no' },
        { channel: 'email', status: 'sent', detail: 'id-1' },
      ]),
    );
    failing.clear();
    const retry = await pressNow();
    expect(retry.body.results).toEqual([{ channel: 'sms', status: 'sent', detail: 'id-1' }]);
    const log = (await request(app).get('/api/messages')).body.messages;
    expect(log).toHaveLength(3); // failed sms, sent email, sent sms
  });

  it('rejects a pressedAt more than 5 minutes from server time', async () => {
    await saveProfile();
    now = IN_AD;
    expect((await pressNow({ pressedAt: now + 5 * 60_000 + 1 })).status).toBe(400);
    expect((await pressNow({ pressedAt: now - 5 * 60_000 - 1 })).status).toBe(400);
  });

  it.each([
    ['unknown trigger', { trigger: 'telepathy' }],
    ['missing trigger', { trigger: undefined }],
    ['unknown mode', { mode: 'soon' }],
    ['unknown channel', { channel: 'fax' }],
    ['non-numeric pressedAt', { pressedAt: 'now' }],
  ])('rejects %s with 400 bad_request', async (_name, extra) => {
    await saveProfile();
    now = IN_AD;
    const res = await pressNow(extra);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
  });

  it('rejects a body that is not json with 400', async () => {
    const res = await request(app)
      .post('/api/capture')
      .set('Content-Type', 'application/json')
      .send('{nope');
    expect(res.status).toBe(400);
  });
});

describe('messages and static files', () => {
  it('returns messages newest first', async () => {
    await saveProfile({ phone: '+15555550100', email: 'd@example.com' });
    now = IN_AD;
    await pressNow();
    now = IN_AD + 1_000;
    await pressNow({ channel: 'email' });
    const log = (await request(app).get('/api/messages')).body.messages;
    expect(log.map((m: { channel: string }) => m.channel)).toEqual(['email', 'sms']);
  });
  it('serves index.html from publicDir', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('car screen');
  });
});
