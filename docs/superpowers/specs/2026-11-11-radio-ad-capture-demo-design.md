# Radio Ad Capture — Working Demo Design

Date: 2026-11-11
Status: awaiting review

## Purpose

A driver or passenger hears a radio advertisement and wants the details
(offer, link, phone number, promo code) without writing anything down or
handling a phone. One press on the car's screen or a physical button sends
the details of the ad airing at that moment to their phone by text, email,
or both.

This first version is a runnable end-to-end demo that proves the idea and
can be shown to stations, advertisers and carmakers. It is not a production
CarPlay app.

## Decisions already made

| Question | Decision |
|---|---|
| First version | Working demo with a simulated car screen |
| How the ad is identified | Simulated station broadcast log, looked up by press timestamp |
| Delivery | Real SMS (Twilio) and email (Resend) when keys are supplied; preview mode otherwise |

## User flow

1. **Setup (parked, once).** The user opens the setup screen and saves a
   mobile number and/or email address and chooses channels: text, email, or
   both. Nothing is typed while driving.
2. **Listening.** The car screen shows the station name, what is on air
   (song or ad), and one large **Send me this ad** button. The `Space` key
   stands in for a physical steering-wheel button and does the same thing.
3. **Capture.** A press sends the press timestamp to the server. The server
   finds the ad, composes the message and delivers it.
4. **Confirmation.** The car screen shows a short confirmation ("Sent to
   your phone: Advertiser name") for a few seconds, then returns to
   now-playing. A phone panel beside the car screen shows each message
   exactly as sent, labelled `sent` or `preview`.

## Behaviour rules

- **During an ad:** capture that ad.
- **Late press:** if no ad is airing but one ended within the last 30
  seconds (`GRACE_SECONDS`), capture that ad.
- **No ad in range:** nothing is sent. The screen says "No ad playing right
  now" and offers a **Send the last ad** button, which captures the most
  recent ad regardless of age.
- **Repeat press:** a second press for the same airing of the same ad
  (same spot, same start time) does not send again. The screen says
  "Already sent".
- **No contact saved:** the press is rejected and the screen directs the
  user to setup.
- **Partial failure:** channels are attempted independently. If SMS fails
  and email succeeds, the result reports each channel's outcome and the
  screen names the one that failed.

## Architecture

One Node.js + TypeScript process serving a JSON API and a static web page.
Run with `npm install && npm start`.

```
src/
  schedule.ts    broadcast log + what airs at time T
  capture.ts     press -> ad resolution (grace window, last ad, dedupe)
  compose.ts     ad -> SMS text and email subject/body
  delivery/
    types.ts     Channel provider interface and result types
    twilio.ts    SMS via Twilio REST API
    resend.ts    email via Resend REST API
    preview.ts   records the message instead of sending
    index.ts     picks providers from environment
  profile.ts     saved contact details and channel choice
  server.ts      HTTP routes, static files
  data/broadcast-log.json
public/
  index.html, app.js, styles.css   car screen, phone panel, setup
test/
```

### Units

**schedule** — Loads the broadcast log: an ordered list of items, each a
`song` or an `ad` with a duration in seconds. The log loops forever from a
fixed epoch (server start). Exposes `itemAt(time)` returning the item, its
airing start time and end time, and `lastAdBefore(time)`. Pure functions of
time; the clock is injected so tests control it.

Ad items carry: `id`, `advertiser`, `headline`, `offer`, `url`, `phone`,
`promoCode` (optional), `expires` (optional).

**capture** — `resolve(pressTime, mode)` where mode is `now` or `last`.
Applies the behaviour rules and returns either an airing (ad + start time)
or a reason (`no_ad`). Keeps an in-memory set of delivered airings per
profile for dedupe.

**compose** — Pure functions. SMS: one message under 320 characters with
advertiser, offer, promo code, short link, phone, and station attribution.
Email: subject `"{advertiser}: {headline}"`, plain-text and simple HTML
body with the same fields plus the time heard.

**delivery** — Each provider implements
`send(message, to) -> { channel, status: 'sent' | 'preview' | 'failed', detail }`.
`twilio.ts` is used when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_FROM` are all set; `resend.ts` when `RESEND_API_KEY` and
`RESEND_FROM` are set. Otherwise that channel uses `preview.ts`. Providers
call the vendors' REST APIs with `fetch`; no vendor SDKs. A provider never
throws to its caller: errors become a `failed` result.

**profile** — A single demo profile (phone, email, channels) held in memory
and persisted to `data/profile.json` (git-ignored). Validates phone in
E.164 format and email shape.

**server** — Routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/now-playing` | Current item, seconds remaining, station name |
| GET | `/api/profile` | Saved contact and channels, and which channels are live vs preview |
| PUT | `/api/profile` | Save contact and channels |
| POST | `/api/capture` | Body `{ pressedAt, mode }`. Returns the ad and per-channel results, or a reason |
| GET | `/api/messages` | Messages delivered or previewed this session, newest first |

### Front end

Plain HTML, CSS and JavaScript, no framework or build step. Three areas:
car screen (landscape, large type, one primary button, sized like an
in-dash display), phone panel (message list), and setup form. The car
screen polls `/api/now-playing` once a second. The press timestamp is taken
in the browser at the moment of the press so network delay does not shift
which ad is matched.

## Error handling

- Invalid profile input: 400 with a field-level message, shown in setup.
- Capture with no profile: 409 `no_contact`.
- Provider failure: 200 with that channel marked `failed` and the vendor's
  error text in `detail`; the other channel is unaffected.
- Malformed capture body: 400.

## Privacy

Contact details stay on the machine running the demo and go only to the
delivery vendor for the chosen channel, and only when the user presses.
`.env` and `data/profile.json` are git-ignored. No analytics.

## Testing

- **schedule:** item at a given time, loop wrap-around, last ad lookup.
- **capture:** during ad, late press inside and outside the grace window,
  press during a song, `last` mode, repeat press.
- **compose:** required fields present, optional fields omitted cleanly,
  SMS length limit.
- **delivery:** provider selection from environment, vendor request shape
  (with `fetch` stubbed), failure mapped to a `failed` result.
- **server:** each route's success and error cases.
- **End to end:** a browser run that saves a profile, waits for an ad,
  presses the button and checks the message appears in the phone panel in
  preview mode.

Real Twilio and Resend sends cannot be verified without the user's own
keys; the README states how to supply them.

## Out of scope, and how each would attach later

- **Real CarPlay app:** an iOS app whose CarPlay template has one button
  calling `POST /api/capture`. Requires a Mac, Xcode and an Apple CarPlay
  entitlement.
- **Physical in-car button:** a head-unit or steering-wheel control mapped
  by the carmaker to the same API call.
- **Real ad identification:** replace `schedule` with a feed from a
  station's playout or ad-traffic system, or with audio fingerprinting.
  `capture` depends only on `itemAt` and `lastAdBefore`.
- **Accounts and multiple users:** replace the single `profile` with
  per-user profiles keyed by a paired phone.
- **Advertiser reporting:** capture events are already structured and could
  be logged and reported.
