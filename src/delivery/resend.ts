import type { Provider } from '../types.js';
import { failureDetail, post, type FetchFn } from './http.js';

export function resendProvider(
  cfg: { apiKey: string; from: string },
  fetchFn: FetchFn = fetch,
): Provider {
  return {
    live: true,
    async send(message) {
      const outcome = await post(fetchFn, 'https://api.resend.com/emails', {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [message.to],
          subject: message.subject ?? '',
          text: message.text,
          html: message.html,
        }),
      });
      if ('error' in outcome) return { channel: 'email', status: 'failed', detail: outcome.error };
      if (!outcome.ok) return { channel: 'email', status: 'failed', detail: failureDetail(outcome) };
      return { channel: 'email', status: 'sent', detail: String(outcome.body.id ?? '') };
    },
  };
}
