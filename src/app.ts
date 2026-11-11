import express from 'express';
import { GRACE_SECONDS, type Capture } from './capture.js';
import { composeEmail, composeSms } from './compose.js';
import { validateProfile, type ProfileStore } from './profile.js';
import type { Schedule } from './schedule.js';
import type {
  Ad,
  AdAiring,
  Channel,
  DeliveryResult,
  OutboundMessage,
  Profile,
  Provider,
  Trigger,
} from './types.js';

/** Presses whose timestamp is further than this from server time are rejected. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_LOGGED_MESSAGES = 200;

export interface AppDeps {
  schedule: Schedule;
  capture: Capture;
  providers: Record<Channel, Provider>;
  profiles: ProfileStore;
  now: () => number;
  station: string;
  publicDir: string;
}

interface LoggedMessage {
  id: number;
  atMs: number;
  trigger: Trigger;
  advertiser: string;
  channel: Channel;
  to: string;
  text: string;
  subject?: string;
  status: DeliveryResult['status'];
  detail: string;
}

interface CaptureRequest {
  pressedAt: number;
  mode: 'now' | 'last';
  trigger: Trigger;
  channel?: Channel;
}

const CHANNELS: readonly string[] = ['sms', 'email'];
const TRIGGERS: readonly string[] = ['touch', 'button', 'voice'];

function parseCaptureRequest(body: unknown, nowMs: number): CaptureRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.pressedAt !== 'number' || !Number.isFinite(b.pressedAt)) return null;
  if (Math.abs(b.pressedAt - nowMs) > MAX_CLOCK_SKEW_MS) return null;
  if (b.mode !== 'now' && b.mode !== 'last') return null;
  if (typeof b.trigger !== 'string' || !TRIGGERS.includes(b.trigger)) return null;
  if (b.channel !== undefined && (typeof b.channel !== 'string' || !CHANNELS.includes(b.channel))) {
    return null;
  }
  return {
    pressedAt: b.pressedAt,
    mode: b.mode,
    trigger: b.trigger as Trigger,
    channel: b.channel as Channel | undefined,
  };
}

const summary = (ad: Ad) => ({ advertiser: ad.advertiser, headline: ad.headline });

function contactFor(profile: Profile, channel: Channel): string | undefined {
  return channel === 'sms' ? profile.phone : profile.email;
}

export function createApp(deps: AppDeps): express.Express {
  const { schedule, capture, providers, profiles, now, station } = deps;
  const messages: LoggedMessage[] = [];
  let nextId = 1;

  function buildMessage(channel: Channel, to: string, airing: AdAiring, heardAtMs: number): OutboundMessage {
    if (channel === 'sms') return { channel, to, text: composeSms(airing.ad, station) };
    return { channel, to, ...composeEmail(airing.ad, station, heardAtMs) };
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/now-playing', (_req, res) => {
    const nowMs = now();
    const airing = schedule.itemAt(nowMs);
    const lastAd = schedule.lastAdBefore(nowMs);
    const item =
      airing.item.kind === 'ad'
        ? { kind: 'ad', ad: summary(airing.item.ad) }
        : { kind: 'song', title: airing.item.title, artist: airing.item.artist };
    const recentAd =
      airing.item.kind !== 'ad' && lastAd && nowMs - lastAd.endMs <= GRACE_SECONDS * 1000
        ? { ...summary(lastAd.ad), endedMs: lastAd.endMs }
        : null;
    res.json({
      station,
      serverTimeMs: nowMs,
      item,
      startMs: airing.startMs,
      endMs: airing.endMs,
      recentAd,
      hasLastAd: lastAd !== null,
    });
  });

  app.get('/api/profile', (_req, res) => {
    res.json({
      profile: profiles.get(),
      live: { sms: providers.sms.live, email: providers.email.live },
    });
  });

  app.put('/api/profile', (req, res) => {
    const result = validateProfile(req.body);
    if (!result.ok) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    profiles.save(result.profile);
    res.json({ profile: result.profile });
  });

  app.post('/api/capture', async (req, res) => {
    const request = parseCaptureRequest(req.body, now());
    if (!request) {
      res.status(400).json({ error: 'bad_request' });
      return;
    }
    const profile = profiles.get();
    if (!profile) {
      res.status(409).json({ error: 'no_contact' });
      return;
    }
    if (request.channel && !contactFor(profile, request.channel)) {
      res.status(409).json({ error: 'missing_contact', channel: request.channel });
      return;
    }

    const resolution = capture.resolve(request.pressedAt, request.mode);
    if (!resolution.ok) {
      res.json({ outcome: 'no_ad' });
      return;
    }
    const { airing, late } = resolution;
    const requested = request.channel ? [request.channel] : profile.defaultChannels;
    const pending = requested.filter((channel) => !capture.alreadySent(airing, channel));
    if (pending.length === 0) {
      res.json({ outcome: 'already_sent', ad: summary(airing.ad) });
      return;
    }

    // Claim the channels before the slow vendor calls so a double press
    // cannot send twice; release any that fail so a retry can resend.
    for (const channel of pending) capture.markSent(airing, channel);
    const results = await Promise.all(
      pending.map(async (channel) => {
        const message = buildMessage(channel, contactFor(profile, channel)!, airing, request.pressedAt);
        let result: DeliveryResult;
        try {
          result = await providers[channel].send(message);
        } catch (err) {
          result = { channel, status: 'failed', detail: err instanceof Error ? err.message : String(err) };
        }
        if (result.status === 'failed') capture.unmarkSent(airing, channel);
        messages.unshift({
          id: nextId++,
          atMs: request.pressedAt,
          trigger: request.trigger,
          advertiser: airing.ad.advertiser,
          channel,
          to: message.to,
          text: message.text,
          ...(message.subject ? { subject: message.subject } : {}),
          status: result.status,
          detail: result.detail,
        });
        return result;
      }),
    );
    messages.length = Math.min(messages.length, MAX_LOGGED_MESSAGES);
    res.json({ outcome: 'sent', ad: summary(airing.ad), late, results });
  });

  app.get('/api/messages', (_req, res) => {
    res.json({ messages });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(express.static(deps.publicDir));

  // Malformed JSON and anything unexpected: answer in JSON, never a stack trace.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: 'bad_request' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
