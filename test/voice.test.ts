import { describe, expect, it } from 'vitest';
import { PHRASES, parseCommand } from '../public/voice.js';

describe('parseCommand', () => {
  it.each([
    ['Send to my phone', 'sms'],
    ['hey siri, send that to my phone.', 'sms'],
    ['text me this ad', 'sms'],
    ['Send to my email', 'email'],
    ['email me that', 'email'],
    ['send it to me by email', 'email'],
    ['Send me this ad', 'default'],
    ['send that', 'default'],
  ])('%s -> %s', (t, ch) => expect(parseCommand(t)).toEqual({ channel: ch }));

  it.each(['turn up the volume', 'call my phone', '', 'what is my email', 'sending regards'])(
    '%s -> null',
    (t) => expect(parseCommand(t)).toBeNull(),
  );

  it('understands every phrase it advertises', () => {
    for (const phrase of PHRASES) expect(parseCommand(phrase)).not.toBeNull();
  });
});
