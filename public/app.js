import { PHRASES, parseCommand } from './voice.js';

const $ = (id) => document.getElementById(id);
const el = {
  station: $('station'),
  clock: $('clock'),
  banner: $('banner'),
  songView: $('song-view'),
  title: $('now-title'),
  artist: $('now-artist'),
  songProgress: $('song-progress'),
  adCard: $('ad-card'),
  adLabel: $('ad-label'),
  adAdvertiser: $('ad-advertiser'),
  adHeadline: $('ad-headline'),
  adProgress: $('ad-progress'),
  sendPhone: $('send-phone'),
  sendEmail: $('send-email'),
  sendLast: $('send-last'),
  mic: $('mic'),
  voiceHint: $('voice-hint'),
  chips: $('phrase-chips'),
  wheel: $('wheel-button'),
  phoneEmpty: $('phone-empty'),
  messages: $('phone-messages'),
  form: $('setup-form'),
  setupStatus: $('setup-status'),
};

const GRACE_MS = 30_000;
const BANNER_MS = 4_000;

/** Server clock minus browser clock, so a press is stamped in server time. */
let clockOffsetMs = 0;
let nowPlaying = null;
const serverNow = () => Date.now() + clockOffsetMs;

// ---------- Now playing ----------

async function pollNowPlaying() {
  try {
    const sentAt = Date.now();
    const res = await fetch('/api/now-playing');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Assume the reply took half the round trip to arrive.
    clockOffsetMs = data.serverTimeMs - (sentAt + Date.now()) / 2;
    nowPlaying = data;
    render();
  } catch {
    el.station.textContent = 'Reconnecting…';
  }
}

function render() {
  if (!nowPlaying) return;
  const { station, item, recentAd, hasLastAd } = nowPlaying;
  el.station.textContent = station;

  const adOnAir = item.kind === 'ad';
  const shownAd = adOnAir ? item.ad : recentAd;
  el.adCard.hidden = !shownAd;
  el.songView.hidden = Boolean(shownAd);
  el.sendLast.hidden = Boolean(shownAd) || !hasLastAd;

  if (shownAd) {
    el.adLabel.textContent = adOnAir ? 'Advertisement' : 'Just heard';
    el.adAdvertiser.textContent = shownAd.advertiser;
    el.adHeadline.textContent = shownAd.headline;
  } else {
    el.title.textContent = item.title;
    el.artist.textContent = item.artist;
  }
  renderProgress();
}

function renderProgress() {
  if (!nowPlaying) return;
  const now = serverNow();
  const { item, startMs, endMs, recentAd } = nowPlaying;
  const fraction = (from, to) => Math.min(1, Math.max(0, (now - from) / (to - from)));
  if (item.kind === 'ad') {
    el.adProgress.style.width = `${fraction(startMs, endMs) * 100}%`;
  } else if (recentAd) {
    // Count down the time left to still catch the ad.
    el.adProgress.style.width = `${(1 - fraction(recentAd.endedMs, recentAd.endedMs + GRACE_MS)) * 100}%`;
  } else {
    el.songProgress.style.width = `${fraction(startMs, endMs) * 100}%`;
  }
  el.clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------- Banner ----------

let bannerTimer;
function showBanner(text, kind = 'ok') {
  el.banner.textContent = text;
  el.banner.dataset.kind = kind;
  el.banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (el.banner.hidden = true), BANNER_MS);
}

// ---------- Capture ----------

const CHANNEL_NAME = { sms: 'Text', email: 'Email' };
let capturing = false;

function describeResults(body) {
  const ok = body.results.filter((r) => r.status !== 'failed');
  const failed = body.results.filter((r) => r.status === 'failed');
  const parts = [];
  if (ok.length > 0) {
    const channels = ok.map((r) => r.channel);
    const lead =
      channels.length === 2
        ? 'Sent to your phone and email'
        : channels[0] === 'sms'
          ? 'Sent to your phone'
          : 'Emailed';
    const preview = ok.some((r) => r.status === 'preview') ? ' (preview)' : '';
    parts.push(`${lead}: ${body.ad.advertiser}${preview}`);
  }
  for (const r of failed) parts.push(`${CHANNEL_NAME[r.channel]} failed: ${r.detail}`);
  return { text: parts.join('. '), kind: failed.length > 0 ? 'error' : 'ok' };
}

/**
 * @param {{ mode: 'now' | 'last', trigger: 'touch' | 'button' | 'voice', channel?: 'sms' | 'email' }} request
 */
async function capture(request) {
  // Stamp the press before anything else so network delay cannot change which ad it matches.
  const pressedAt = Math.round(serverNow());
  if (capturing) return;
  capturing = true;
  el.sendPhone.disabled = el.sendEmail.disabled = el.sendLast.disabled = true;
  try {
    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pressedAt, ...request }),
    });
    const body = await res.json();
    if (res.status === 409) {
      const wantsEmail = body.error === 'missing_contact' && body.channel === 'email';
      showBanner(
        wantsEmail ? 'Add your email address in Setup first' : 'Add your phone number in Setup first',
        'info',
      );
    } else if (!res.ok) {
      showBanner('Something went wrong. Try again', 'error');
    } else if (body.outcome === 'no_ad') {
      showBanner('No ad playing right now', 'info');
    } else if (body.outcome === 'already_sent') {
      showBanner(`Already sent: ${body.ad.advertiser}`, 'info');
    } else {
      const { text, kind } = describeResults(body);
      showBanner(text, kind);
    }
    await loadMessages();
  } catch {
    showBanner('No connection. Try again', 'error');
  } finally {
    capturing = false;
    el.sendPhone.disabled = el.sendEmail.disabled = el.sendLast.disabled = false;
  }
}

el.sendPhone.addEventListener('click', () => capture({ mode: 'now', channel: 'sms', trigger: 'touch' }));
el.sendEmail.addEventListener('click', () => capture({ mode: 'now', channel: 'email', trigger: 'touch' }));
el.sendLast.addEventListener('click', () => capture({ mode: 'last', trigger: 'touch' }));
el.wheel.addEventListener('click', () => capture({ mode: 'now', trigger: 'button' }));

// The space bar stands in for a physical steering wheel button. It does so
// even when an on-screen button has focus (otherwise Space would re-press
// whatever was clicked last); Enter still activates a focused button.
const isTypingTarget = (target) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select'));

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || isTypingTarget(event.target)) return;
  event.preventDefault();
  if (!event.repeat) capture({ mode: 'now', trigger: 'button' });
});
// Buttons activate on Space keyup, so that has to be cancelled as well.
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && !isTypingTarget(event.target)) event.preventDefault();
});

// ---------- Voice ----------

function handleTranscript(transcript) {
  const command = parseCommand(transcript);
  if (!command) {
    showBanner(`Heard “${transcript}”. Try: ${PHRASES[0]}`, 'info');
    return;
  }
  capture({
    mode: 'now',
    trigger: 'voice',
    ...(command.channel === 'default' ? {} : { channel: command.channel }),
  });
}

for (const phrase of PHRASES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'phrase-chip';
  chip.textContent = phrase;
  chip.addEventListener('click', () => handleTranscript(phrase));
  el.chips.append(chip);
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function setListening(on) {
  el.mic.setAttribute('aria-pressed', String(on));
  el.voiceHint.textContent = on ? 'Listening…' : 'Say or tap a command';
}

el.mic.addEventListener('click', () => {
  if (!Recognition) {
    showBanner('Voice is not available in this browser. Tap a command instead', 'info');
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => handleTranscript(event.results[0][0].transcript);
  recognition.onerror = (event) => {
    const denied = event.error === 'not-allowed' || event.error === 'service-not-allowed';
    showBanner(
      denied ? 'Microphone is blocked. Tap a command instead' : 'Did not catch that. Tap a command instead',
      'info',
    );
  };
  recognition.onend = () => {
    recognition = null;
    setListening(false);
  };
  setListening(true);
  recognition.start();
});

// ---------- Phone panel ----------

const TRIGGER_NAME = { touch: 'Screen tap', button: 'Wheel button', voice: 'Voice' };

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    if (!res.ok) return;
    const { messages } = await res.json();
    el.phoneEmpty.hidden = messages.length > 0;
    el.messages.replaceChildren(
      ...messages.map((m) => {
        const item = node('li', 'message');
        const meta = node('div', 'message-meta');
        const status = node('span', 'tag', m.status === 'preview' ? 'Preview' : m.status === 'sent' ? 'Sent' : 'Failed');
        status.dataset.status = m.status;
        const time = new Date(m.atMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        meta.append(
          status,
          node('span', '', `${CHANNEL_NAME[m.channel]} to ${m.to}`),
          node('span', '', `${TRIGGER_NAME[m.trigger]}, ${time}`),
        );
        item.append(meta);
        if (m.subject) item.append(node('div', 'message-subject', m.subject));
        item.append(node('div', 'message-body', m.text));
        if (m.status === 'failed') item.append(node('div', 'error', m.detail));
        return item;
      }),
    );
  } catch {
    // The next capture or reload will refresh the list.
  }
}

// ---------- Setup ----------

function setBadge(id, live) {
  const badge = $(id);
  badge.textContent = live ? 'Live' : 'Preview mode';
  badge.dataset.live = String(live);
}

function showErrors(errors = {}) {
  for (const field of ['phone', 'email', 'defaultChannels']) {
    $(`error-${field}`).textContent = errors[field] ?? '';
  }
  el.form.phone.setAttribute('aria-invalid', String(Boolean(errors.phone)));
  el.form.email.setAttribute('aria-invalid', String(Boolean(errors.email)));
}

async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const { profile, live } = await res.json();
    setBadge('badge-sms', live.sms);
    setBadge('badge-email', live.email);
    if (!profile) return;
    el.form.phone.value = profile.phone ?? '';
    el.form.email.value = profile.email ?? '';
    el.form.default.value = profile.defaultChannels.length === 2 ? 'both' : profile.defaultChannels[0];
  } catch {
    // Setup still works; saving will report any problem.
  }
}

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.setupStatus.textContent = '';
  const choice = el.form.default.value;
  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: el.form.phone.value,
        email: el.form.email.value,
        defaultChannels: choice === 'both' ? ['sms', 'email'] : [choice],
      }),
    });
    const body = await res.json();
    showErrors(res.ok ? {} : body.errors);
    el.setupStatus.textContent = res.ok ? 'Saved' : '';
  } catch {
    el.setupStatus.textContent = 'Could not save. Is the server running?';
  }
});

// ---------- Start ----------

loadProfile();
loadMessages();
pollNowPlaying();
setInterval(pollNowPlaying, 1000);
setInterval(renderProgress, 200);
