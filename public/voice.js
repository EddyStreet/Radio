// Turns a spoken phrase into a capture command. No dependencies, so it runs
// in the browser and in the test suite unchanged.

export const PHRASES = ['Send to my phone', 'Send to my email', 'Send me this ad'];

const OBJECT_WORDS = new Set(['me', 'this', 'that', 'it', 'myself']);
const AD_WORDS = new Set(['ad', 'advert', 'advertisement', 'commercial', 'this', 'that', 'it']);

/**
 * @param {string} transcript
 * @returns {{ channel: 'sms' | 'email' | 'default' } | null}
 */
export function parseCommand(transcript) {
  const words = String(transcript ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const has = (word) => words.includes(word);

  if (has('send')) {
    if (has('email')) return { channel: 'email' };
    if (has('phone') || has('text')) return { channel: 'sms' };
    if (words.some((w) => AD_WORDS.has(w))) return { channel: 'default' };
    return null;
  }

  // "text me this ad", "email me that": the channel word used as the verb.
  for (let i = 0; i < words.length - 1; i++) {
    if (!OBJECT_WORDS.has(words[i + 1])) continue;
    if (words[i] === 'text') return { channel: 'sms' };
    if (words[i] === 'email') return { channel: 'email' };
  }
  return null;
}
