import type { Provider } from '../types.js';
import { failureDetail, post, type FetchFn } from './http.js';

export function twilioProvider(
  cfg: { sid: string; token: string; from: string },
  fetchFn: FetchFn = fetch,
): Provider {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64');
  return {
    live: true,
    async send(message) {
      const outcome = await post(fetchFn, url, {
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: message.to, From: cfg.from, Body: message.text }).toString(),
      });
      if ('error' in outcome) return { channel: 'sms', status: 'failed', detail: outcome.error };
      if (!outcome.ok) return { channel: 'sms', status: 'failed', detail: failureDetail(outcome) };
      return { channel: 'sms', status: 'sent', detail: String(outcome.body.sid ?? '') };
    },
  };
}
