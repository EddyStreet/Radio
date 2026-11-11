# Radio Ad Capture Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable demo in which a simulated car screen shows a radio ad with a **Send to phone** button, and a touch, steering-wheel press or voice command sends that ad's details to the user's phone by text (or email).

**Architecture:** One Node.js + TypeScript process serves a JSON API and a static page. Pure units (schedule, capture, compose, voice parsing) sit behind small interfaces; delivery providers call Twilio and Resend over REST and fall back to a preview provider when keys are absent.

**Tech Stack:** Node.js 20+, TypeScript (run with `tsx`), Express, Vitest, Supertest, Playwright (pre-installed, end-to-end only). Front end is plain HTML/CSS/ES modules with no build step.

**Spec:** `docs/superpowers/specs/2026-11-11-radio-ad-capture-demo-design.md`

## Global Constraints

- Start command is `npm install && npm start`; server listens on `PORT` (default `3000`).
- No vendor SDKs: Twilio and Resend are called with global `fetch`.
- No front-end framework or build step.
- `GRACE_SECONDS = 30`.
- SMS body is at most 320 characters.
- Phone numbers are E.164 (`^\+[1-9]\d{7,14}$`).
- Default channel is `sms`. Channel names are exactly `sms` and `email`.
- Trigger names are exactly `touch`, `button`, `voice`.
- Button copy is exactly **Send to phone**, **Email**, **Send last ad**.
- `.env` and `data/profile.json` are git-ignored; `.env.example` is committed.
- Providers never throw to callers; errors become `{ status: 'failed' }`.
- Times are epoch milliseconds everywhere in code and API.

## Review Focus

1. A `pressedAt` far from the server clock (browser clock skew, or a stale tab) must not match an arbitrary ad: reject presses more than 5 minutes from server time with 400. (Task 6)
2. A profile whose default channel has no contact saved (default `sms`, only email saved) must not silently send nothing: `PUT /api/profile` rejects it with 400. (Task 5)
3. A corrupt or hand-edited `data/profile.json` must not crash startup: treat as no profile. (Task 5)
4. An ad with a very long offer must still produce an SMS of at most 320 characters with the URL intact: truncate the offer, never the link. (Task 3)
5. A vendor that hangs must not hang the car screen: provider requests time out after 10 seconds and report `failed`. (Task 4)

---

## Shared types (`src/types.ts`, created in Task 1)

```ts
export type Channel = 'sms' | 'email';
export type Trigger = 'touch' | 'button' | 'voice';

export interface Ad {
  id: string; advertiser: string; headline: string; offer: string;
  url: string; phone: string; promoCode?: string; expires?: string;
}
export type LogItem =
  | { kind: 'song'; title: string; artist: string; durationSec: number }
  | { kind: 'ad'; durationSec: number; ad: Ad };

export interface Airing { item: LogItem; startMs: number; endMs: number }
export interface AdAiring { ad: Ad; startMs: number; endMs: number }

export interface OutboundMessage {
  channel: Channel; to: string; text: string; subject?: string; html?: string;
}
export interface DeliveryResult {
  channel: Channel; status: 'sent' | 'preview' | 'failed'; detail: string;
}
export interface Provider {
  readonly live: boolean;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
export interface Profile {
  phone?: string; email?: string; defaultChannels: Channel[];
}
```

---

### Task 1: Project scaffold and broadcast schedule

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/types.ts`, `src/schedule.ts`, `src/data/broadcast-log.json`
- Test: `test/schedule.test.ts`

**Interfaces:**
- Produces: `createSchedule(log: LogItem[], epochMs: number): Schedule` with `itemAt(timeMs: number): Airing` and `lastAdBefore(timeMs: number): AdAiring | null`; `loadBroadcastLog(): LogItem[]`; `STATION_NAME = 'KDEMO 101.5 FM'`.

- [ ] **Step 1: Scaffold.** `package.json` with `"type": "module"`, scripts `start: tsx src/server.ts`, `test: vitest run`; dependencies `express`, `tsx`; devDependencies `typescript`, `vitest`, `supertest`, `@types/express`, `@types/supertest`, `@types/node`. `.gitignore`: `node_modules`, `.env`, `data/profile.json`. `.env.example` lists `PORT`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `RESEND_API_KEY`, `RESEND_FROM` with empty values. Write `src/types.ts` from the Shared types block.

- [ ] **Step 2: Write the broadcast log.** `src/data/broadcast-log.json`: about 12 items alternating two songs (20–25 s each, shortened for demo pacing) with one ad (15 s), using at least four fictional advertisers with fictional `example.com` URLs and `+1555…` phone numbers; one ad has no `promoCode` and one has `expires`.

- [ ] **Step 3: Write failing tests** in `test/schedule.test.ts` using a fixed three-item log `[song 20s, ad A 15s, song 25s]` (loop 60 s) and `epochMs = 1_000_000`:

```ts
it('returns the song at the start', () => expect(s.itemAt(1_000_000).item.kind).toBe('song'));
it('returns the ad with its airing bounds', () => {
  const a = s.itemAt(1_000_000 + 25_000);
  expect(a.item.kind).toBe('ad');
  expect(a.startMs).toBe(1_020_000); expect(a.endMs).toBe(1_035_000);
});
it('treats an item end as exclusive', () => expect(s.itemAt(1_035_000).item.kind).toBe('song'));
it('wraps around the loop', () => expect(s.itemAt(1_000_000 + 60_000 + 25_000).startMs).toBe(1_080_000));
it('finds the last ad before a time in a later song', () =>
  expect(s.lastAdBefore(1_040_000)).toMatchObject({ startMs: 1_020_000, endMs: 1_035_000 }));
it('finds the previous loop\'s ad when none has aired yet this loop', () =>
  expect(s.lastAdBefore(1_060_000 + 5_000)!.startMs).toBe(1_020_000));
it('returns null before any ad has ever aired', () => expect(s.lastAdBefore(1_005_000)).toBeNull());
it('returns the current ad from lastAdBefore while it airs', () =>
  expect(s.lastAdBefore(1_025_000)!.startMs).toBe(1_020_000));
it('loads the bundled log with at least one ad', () =>
  expect(loadBroadcastLog().some(i => i.kind === 'ad')).toBe(true));
```

- [ ] **Step 4: Run** `npx vitest run test/schedule.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 5: Implement `src/schedule.ts`.** `lastAdBefore` returns the most recent ad airing whose `startMs <= timeMs` and `startMs >= epochMs`.
- [ ] **Step 6: Run** the same command. Expected: PASS.
- [ ] **Step 7: Commit** `feat: scaffold project and broadcast schedule`.

### Task 2: Capture resolution

**Files:**
- Create: `src/capture.ts`
- Test: `test/capture.test.ts`

**Interfaces:**
- Consumes: `Schedule` from Task 1.
- Produces:

```ts
export const GRACE_SECONDS = 30;
export type Resolution =
  | { ok: true; airing: AdAiring; late: boolean }
  | { ok: false; reason: 'no_ad' };
export function createCapture(schedule: Schedule): {
  resolve(pressedAtMs: number, mode: 'now' | 'last'): Resolution;
  alreadySent(airing: AdAiring, channel: Channel): boolean;
  markSent(airing: AdAiring, channel: Channel): void;
};
```

Dedupe key is `ad.id + startMs + channel`, so sending the same airing by email after text is allowed.

- [ ] **Step 1: Write failing tests** with the Task 1 fixture log:

```ts
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
  const r = c.resolve(1_025_000, 'now'); if (!r.ok) throw new Error();
  expect(c.alreadySent(r.airing, 'sms')).toBe(false);
  c.markSent(r.airing, 'sms');
  expect(c.alreadySent(r.airing, 'sms')).toBe(true);
  expect(c.alreadySent(r.airing, 'email')).toBe(false);
});
it('does not dedupe the same ad in the next loop', () => {
  const a = c.resolve(1_025_000, 'now'), b = c.resolve(1_085_000, 'now');
  if (!a.ok || !b.ok) throw new Error();
  c.markSent(a.airing, 'sms'); expect(c.alreadySent(b.airing, 'sms')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run test/capture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/capture.ts`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: resolve presses to ad airings`.

### Task 3: Message composition

**Files:**
- Create: `src/compose.ts`
- Test: `test/compose.test.ts`

**Interfaces:**
- Produces: `composeSms(ad: Ad, station: string): string`; `composeEmail(ad: Ad, station: string, heardAtMs: number): { subject: string; text: string; html: string }`; `SMS_MAX = 320`.

SMS format, lines joined with `\n`, optional lines omitted entirely:

```
{advertiser}: {offer}
Code: {promoCode}
{url}
Call {phone}
Heard on {station}
```

- [ ] **Step 1: Write failing tests:**

```ts
const ad = { id: 'a1', advertiser: 'Harbor Tire', headline: 'Winter tire sale',
  offer: 'Buy 3 tires, get the 4th free', url: 'https://example.com/harbor',
  phone: '+15555550142', promoCode: 'RADIO4', expires: '2026-12-31' };

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
  expect(t).toContain(ad.url); expect(t).toContain('…');
});
it('email subject is advertiser: headline', () =>
  expect(composeEmail(ad, 'K', 0).subject).toBe('Harbor Tire: Winter tire sale'));
it('email text carries fields, expiry and time heard', () => {
  const e = composeEmail(ad, 'KDEMO 101.5 FM', Date.UTC(2026, 10, 11, 15, 4));
  for (const s of [ad.offer, ad.url, ad.phone, 'RADIO4', '2026-12-31', 'KDEMO 101.5 FM'])
    expect(e.text).toContain(s);
});
it('email html escapes advertiser-supplied text', () =>
  expect(composeEmail({ ...ad, offer: '<b>50%</b> & more' }, 'K', 0).html)
    .toContain('&lt;b&gt;50%&lt;/b&gt; &amp; more'));
```

- [ ] **Step 2: Run** `npx vitest run test/compose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/compose.ts`.** Over-length SMS: shorten only `offer`, ending it with `…`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: compose sms and email messages`.

### Task 4: Delivery providers

**Files:**
- Create: `src/delivery/preview.ts`, `src/delivery/twilio.ts`, `src/delivery/resend.ts`, `src/delivery/index.ts`
- Test: `test/delivery.test.ts`

**Interfaces:**
- Consumes: `Provider`, `OutboundMessage`, `DeliveryResult` from `src/types.ts`.
- Produces:

```ts
type FetchFn = typeof fetch;
export function previewProvider(channel: Channel): Provider;              // live: false
export function twilioProvider(cfg: { sid: string; token: string; from: string }, fetchFn?: FetchFn): Provider;
export function resendProvider(cfg: { apiKey: string; from: string }, fetchFn?: FetchFn): Provider;
export function createProviders(env: NodeJS.ProcessEnv, fetchFn?: FetchFn): Record<Channel, Provider>;
export const PROVIDER_TIMEOUT_MS = 10_000;
```

Vendor requests:
- Twilio: `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, header `Authorization: Basic base64(sid:token)`, form-encoded body `To`, `From`, `Body`. Success is HTTP 2xx; `detail` is the returned `sid`. Failure `detail` is the JSON `message` field or `HTTP {status}`.
- Resend: `POST https://api.resend.com/emails`, header `Authorization: Bearer {apiKey}`, JSON body `{ from, to: [to], subject, text, html }`. Success `detail` is the returned `id`.

- [ ] **Step 1: Write failing tests** (stub `fetchFn` with `vi.fn`):

```ts
it('preview returns status preview and is not live', ...);
it('uses preview for both channels when env is empty', ...);          // createProviders({}).sms.live === false
it('uses twilio only when all three twilio vars are set', ...);       // two of three -> preview
it('uses resend only when both resend vars are set', ...);
it('twilio posts form fields to the account messages url with basic auth', ...);
it('twilio maps a 2xx to sent with the message sid', ...);
it('twilio maps a 400 to failed with the vendor message', ...);
it('resend posts json with bearer auth and maps 2xx to sent with the id', ...);
it('a rejected fetch becomes failed, not a throw', ...);
it('a hung fetch becomes failed after 10s', ...);                      // vi.useFakeTimers + AbortSignal
```

Each asserts the exact URL, header and body values listed above.

- [ ] **Step 2: Run** `npx vitest run test/delivery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the four files.** Timeout via `AbortSignal.timeout(PROVIDER_TIMEOUT_MS)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: twilio, resend and preview delivery providers`.

### Task 5: Profile store

**Files:**
- Create: `src/profile.ts`
- Test: `test/profile.test.ts`

**Interfaces:**
- Produces:

```ts
export type ProfileErrors = Partial<Record<'phone' | 'email' | 'defaultChannels', string>>;
export function validateProfile(input: unknown): { ok: true; profile: Profile } | { ok: false; errors: ProfileErrors };
export function createProfileStore(filePath: string): { get(): Profile | null; save(p: Profile): void };
```

Rules: `phone` optional, E.164; `email` optional, `^[^\s@]+@[^\s@]+\.[^\s@]+$`; at least one of them present; `defaultChannels` defaults to `['sms']` if phone present else `['email']`; every default channel must have its contact saved; empty strings are treated as absent.

- [ ] **Step 1: Write failing tests:**

```ts
it('accepts a phone-only profile and defaults to sms', ...);
it('accepts an email-only profile and defaults to email', ...);
it('rejects a non-E.164 phone', ...);              // '555-0142' -> errors.phone
it('rejects a malformed email', ...);
it('rejects a profile with neither contact', ...);
it('rejects default sms when no phone is saved', ...);   // errors.defaultChannels
it('rejects an unknown channel name', ...);
it('persists and reloads from disk', ...);         // temp dir
it('returns null when the file is missing', ...);
it('returns null when the file is corrupt json', ...);
```

- [ ] **Step 2: Run** `npx vitest run test/profile.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/profile.ts`.** `save` creates the parent directory if needed.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: profile validation and storage`.

### Task 6: HTTP API

**Files:**
- Create: `src/app.ts` (builds the Express app from injected dependencies), `src/server.ts` (wires real dependencies and listens)
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:

```ts
export function createApp(deps: {
  schedule: Schedule; capture: ReturnType<typeof createCapture>;
  providers: Record<Channel, Provider>;
  profiles: ReturnType<typeof createProfileStore>;
  now: () => number; station: string; publicDir: string;
}): express.Express;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
```

Routes and JSON shapes:

| Route | Response |
|---|---|
| `GET /api/now-playing` | `{ station, serverTimeMs, item: { kind, title?, artist?, ad?: { advertiser, headline } }, startMs, endMs, recentAd: { advertiser, headline, endedMs } \| null }`. `recentAd` is set only while no ad is airing and one ended within `GRACE_SECONDS`. |
| `GET /api/profile` | `{ profile: Profile \| null, live: { sms: boolean, email: boolean } }` |
| `PUT /api/profile` | 200 `{ profile }` or 400 `{ errors }` |
| `POST /api/capture` | Body `{ pressedAt: number, mode: 'now'\|'last', channel?: Channel, trigger: Trigger }` |
| `GET /api/messages` | `{ messages: Array<{ id, atMs, trigger, advertiser, channel, to, text, subject?, status, detail }> }`, newest first, in memory |

`POST /api/capture` outcomes:
- 400 `{ error: 'bad_request' }` for wrong types, unknown `mode`/`channel`/`trigger`, or `|pressedAt - now()| > MAX_CLOCK_SKEW_MS`.
- 409 `{ error: 'no_contact' }` when no profile is saved.
- 409 `{ error: 'missing_contact', channel }` when `channel` is named but that contact is not saved.
- 200 `{ outcome: 'no_ad' }`.
- 200 `{ outcome: 'already_sent', ad }` when every requested channel was already sent for this airing.
- 200 `{ outcome: 'sent', ad: { advertiser, headline }, late, results: DeliveryResult[] }`. Channels are `[channel]` if given, else `profile.defaultChannels`; already-sent channels are skipped; providers run concurrently; `markSent` is called only for `sent` or `preview` results; every attempted result (including `failed`) is appended to the message log.

- [ ] **Step 1: Write failing tests** with Supertest, the Task 1 fixture log, a mutable `now`, recording stub providers and a temp profile file:

```ts
it('now-playing reports a song, then an ad with advertiser and headline', ...);
it('now-playing exposes recentAd for 30s after an ad ends and not after', ...);
it('profile round-trips and reports live flags', ...);
it('PUT profile returns 400 with field errors', ...);
it('capture without a profile is 409 no_contact', ...);
it('capture during an ad sends by default channel and logs the message', ...);
it('capture with channel email sends only email', ...);
it('capture with a channel that has no contact is 409 missing_contact', ...);
it('capture during a song is no_ad and sends nothing', ...);
it('capture in last mode during a song sends the previous ad', ...);
it('a second capture of the same airing is already_sent', ...);
it('sms failure and email success are both reported; a retry resends only sms', ...);
it('rejects a pressedAt more than 5 minutes from server time', ...);
it('rejects an unknown trigger', ...);
it('messages are returned newest first', ...);
it('serves index.html from publicDir', ...);
```

- [ ] **Step 2: Run** `npx vitest run test/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/app.ts` and `src/server.ts`.** `server.ts` loads `.env` with `process.loadEnvFile` when the file exists, uses `Date.now()` at start as the schedule epoch, profile path `data/profile.json`, and logs the URL plus which channels are live or preview.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: http api for now-playing, profile and capture`.

### Task 7: Voice command parsing

**Files:**
- Create: `public/voice.js`
- Test: `test/voice.test.ts`

**Interfaces:**
- Produces: `export function parseCommand(transcript: string): { channel: 'sms' | 'email' | 'default' } | null` and `export const PHRASES = ['Send to my phone', 'Send to my email', 'Send me this ad']`.

Matching is case-insensitive and ignores punctuation. Requires the word `send` (or `text`/`email` used as a verb). `phone` or `text` → `sms`; `email` → `email`; `send` plus `ad`/`this`/`that`/`it` with no channel word → `default`.

- [ ] **Step 1: Write failing tests:**

```ts
it.each([
  ['Send to my phone', 'sms'], ['hey siri, send that to my phone.', 'sms'],
  ['text me this ad', 'sms'], ['Send to my email', 'email'],
  ['email me that', 'email'], ['send it to me by email', 'email'],
  ['Send me this ad', 'default'], ['send that', 'default'],
])('%s -> %s', (t, ch) => expect(parseCommand(t)).toEqual({ channel: ch }));
it.each(['turn up the volume', 'call my phone', '', 'what is my email'])(
  '%s -> null', t => expect(parseCommand(t)).toBeNull());
```

- [ ] **Step 2: Run** `npx vitest run test/voice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `public/voice.js`** as a dependency-free ES module.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: parse spoken send commands`.

### Task 8: Car screen, phone panel and setup UI

**Files:**
- Create: `public/index.html`, `public/styles.css`, `public/app.js`
- Test: `test/e2e.mjs` (Playwright script run with `node test/e2e.mjs`; add script `"e2e"`)

**Interfaces:**
- Consumes: the Task 6 API and `parseCommand`, `PHRASES` from Task 7.

Layout: car screen (16:9 landscape, dark, minimum 24 px text, touch targets at least 76 px tall) on the left; phone panel and setup form on the right; stacked below 900 px wide.

Car screen states, driven by polling `/api/now-playing` every second:
- **Song:** station, title, artist, progress bar, and a small **Send last ad** control (hidden until an ad has aired).
- **Ad on air:** ad card with an "Advertisement" label, advertiser, headline, large **Send to phone** button and smaller **Email** button.
- **Just heard:** the same card labelled "Just heard", shown while `recentAd` is set.
- **Result banner (4 s):** `Sent to your phone: {advertiser}`, `Emailed: {advertiser}`, `Already sent`, `No ad playing right now`, `{channel} failed: {detail}`, or `Add your phone number in Setup first`. In preview mode the banner appends `(preview)`.

Triggers:
- **Send to phone** → `{ mode:'now', channel:'sms', trigger:'touch' }`; **Email** → `channel:'email'`; **Send last ad** → `{ mode:'last', trigger:'touch' }`.
- `Space` keydown (ignored when focus is in an input, and on key repeat) → `{ mode:'now', trigger:'button' }`.
- Microphone button: uses `SpeechRecognition`/`webkitSpeechRecognition` when present; the three `PHRASES` render as clickable chips under it in every browser. A transcript goes through `parseCommand`; `null` shows `Heard "{transcript}". Try: Send to my phone`; otherwise `{ mode:'now', channel (omitted for default), trigger:'voice' }`.
- `pressedAt` is `Date.now()` captured in the event handler, corrected by the offset between `serverTimeMs` and the browser clock measured from the last poll.

Setup form: phone, email, default channel (Text / Email / Both), Save; shows field errors from the API; shows a "Live" or "Preview mode" badge per channel. Phone panel: renders `/api/messages` as message bubbles (SMS) and cards (email) with status and trigger labels; refreshed after each capture.

Stable selectors for the test: `#send-phone`, `#send-email`, `#send-last`, `#mic`, `.phrase-chip`, `#banner`, `#ad-card`, `#phone-messages .message`, `#setup-form`.

- [ ] **Step 1: Write `test/e2e.mjs`.** It starts the server on a free port with a temp profile path and no vendor keys, opens the page in Chromium, and asserts in order:
  1. `#ad-card` is hidden during the opening song.
  2. Saving phone `+15555550100` shows a Preview mode badge.
  3. `#ad-card` becomes visible within 40 s and `#send-phone` reads `Send to phone`.
  4. Clicking `#send-phone` shows a banner containing `Sent to your phone` and one `.message` containing the advertiser name and `preview`.
  5. Clicking it again shows `Already sent` and the message count stays 1.
  6. Clicking the `Send to my email` chip shows the setup-first/missing-email banner and sends nothing.
  7. After the card disappears, pressing `Space` shows `No ad playing right now`, and `#send-last` then shows `Already sent`.
  Exits non-zero on any failure. `server.ts` must honour `PROFILE_PATH` for this.

- [ ] **Step 2: Run** `node test/e2e.mjs`. Expected: FAIL (page missing).
- [ ] **Step 3: Build the three front-end files** to the description above.
- [ ] **Step 4: Run** `node test/e2e.mjs` and `npx vitest run`. Expected: both PASS.
- [ ] **Step 5: Look at it.** Take screenshots of the song state, the ad card and the phone panel at 1280×800 and 390×844; fix overlap, clipping or unreadable contrast.
- [ ] **Step 6: Commit** `feat: car screen, phone panel and setup ui`.

### Task 9: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README:** what the demo shows; `npm install && npm start`; a two-minute demo script (save number, wait for ad, tap, spacebar, voice chip); how to enable real texts and email by copying `.env.example` to `.env` (Twilio trial accounts can only text verified numbers; US numbers need registration for unverified recipients; Resend needs a verified sending domain); how to edit `src/data/broadcast-log.json`; how to run tests; a short "From demo to car" section summarising the spec's out-of-scope attachments (CarPlay, head units, voice assistants, real ad feeds).
- [ ] **Step 2: Verify** every command in the README by running it from a clean `npm ci`.
- [ ] **Step 3: Commit** `docs: add readme`.
