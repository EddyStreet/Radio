import type { Channel, Provider } from '../types.js';
import type { FetchFn } from './http.js';
import { previewProvider } from './preview.js';
import { resendProvider } from './resend.js';
import { twilioProvider } from './twilio.js';

export { PROVIDER_TIMEOUT_MS } from './http.js';
export { previewProvider, resendProvider, twilioProvider };

/** Real vendors where their keys are fully configured, preview otherwise. */
export function createProviders(
  env: Record<string, string | undefined>,
  fetchFn: FetchFn = fetch,
): Record<Channel, Provider> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  const { RESEND_API_KEY: apiKey, RESEND_FROM: resendFrom } = env;
  return {
    sms: sid && token && from ? twilioProvider({ sid, token, from }, fetchFn) : previewProvider('sms'),
    email:
      apiKey && resendFrom
        ? resendProvider({ apiKey, from: resendFrom }, fetchFn)
        : previewProvider('email'),
  };
}
