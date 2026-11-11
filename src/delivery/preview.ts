import type { Channel, Provider } from '../types.js';

/** Stands in for a real vendor when no keys are configured. Sends nothing. */
export function previewProvider(channel: Channel): Provider {
  return {
    live: false,
    async send() {
      return { channel, status: 'preview', detail: 'Preview mode: not actually sent' };
    },
  };
}
