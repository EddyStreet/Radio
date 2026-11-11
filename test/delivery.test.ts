import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProviders,
  previewProvider,
  resendProvider,
  twilioProvider,
} from '../src/delivery/index.js';
import type { OutboundMessage } from '../src/types.js';

const sms: OutboundMessage = { channel: 'sms', to: '+15555550100', text: 'hello' };
const email: OutboundMessage = {
  channel: 'email',
  to: 'driver@example.com',
  text: 'plain',
  subject: 'Subj',
  html: '<p>plain</p>',
};
const twilioCfg = { sid: 'AC123', token: 'tok', from: '+15555550999' };
const resendCfg = { apiKey: 're_key', from: 'Radio <ads@example.com>' };
const TWILIO_ENV = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15555550999' };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.useRealTimers());

describe('delivery', () => {
  it('preview returns status preview and is not live', async () => {
    const p = previewProvider('sms');
    expect(p.live).toBe(false);
    expect(await p.send(sms)).toMatchObject({ channel: 'sms', status: 'preview' });
  });

  it('uses preview for both channels when env is empty', () => {
    const p = createProviders({});
    expect(p.sms.live).toBe(false);
    expect(p.email.live).toBe(false);
  });

  it('uses twilio only when all three twilio vars are set', () => {
    expect(createProviders(TWILIO_ENV).sms.live).toBe(true);
    expect(createProviders({ ...TWILIO_ENV, TWILIO_FROM: '' }).sms.live).toBe(false);
    expect(createProviders(TWILIO_ENV).email.live).toBe(false);
  });

  it('uses resend only when both resend vars are set', () => {
    expect(createProviders({ RESEND_API_KEY: 'k', RESEND_FROM: 'a@example.com' }).email.live).toBe(true);
    expect(createProviders({ RESEND_API_KEY: 'k' }).email.live).toBe(false);
  });

  it('twilio posts form fields to the account messages url with basic auth', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(201, { sid: 'SM1' }));
    await twilioProvider(twilioCfg, fetchFn).send(sms);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('AC123:tok').toString('base64'));
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ To: '+15555550100', From: '+15555550999', Body: 'hello' });
  });

  it('twilio maps a 2xx to sent with the message sid', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(201, { sid: 'SM1' }));
    expect(await twilioProvider(twilioCfg, fetchFn).send(sms)).toEqual({
      channel: 'sms',
      status: 'sent',
      detail: 'SM1',
    });
  });

  it('twilio maps a 400 to failed with the vendor message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(400, { message: 'Invalid To number' }));
    expect(await twilioProvider(twilioCfg, fetchFn).send(sms)).toEqual({
      channel: 'sms',
      status: 'failed',
      detail: 'Invalid To number',
    });
  });

  it('falls back to the http status when a failure has no json body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('oops', { status: 503 }));
    expect(await twilioProvider(twilioCfg, fetchFn).send(sms)).toMatchObject({
      status: 'failed',
      detail: 'HTTP 503',
    });
  });

  it('resend posts json with bearer auth and maps 2xx to sent with the id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'em_1' }));
    const result = await resendProvider(resendCfg, fetchFn).send(email);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'Radio <ads@example.com>',
      to: ['driver@example.com'],
      subject: 'Subj',
      text: 'plain',
      html: '<p>plain</p>',
    });
    expect(result).toEqual({ channel: 'email', status: 'sent', detail: 'em_1' });
  });

  it('a rejected fetch becomes failed, not a throw', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await resendProvider(resendCfg, fetchFn).send(email)).toEqual({
      channel: 'email',
      status: 'failed',
      detail: 'network down',
    });
  });

  it('a hung fetch becomes failed after 10s', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = twilioProvider(twilioCfg, fetchFn as unknown as typeof fetch).send(sms);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toMatchObject({ status: 'failed', detail: 'Timed out after 10s' });
  });
});
