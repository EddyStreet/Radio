export type Channel = 'sms' | 'email';
export type Trigger = 'touch' | 'button' | 'voice';

export interface Ad {
  id: string;
  advertiser: string;
  headline: string;
  offer: string;
  url: string;
  phone: string;
  promoCode?: string;
  expires?: string;
}

export type LogItem =
  | { kind: 'song'; title: string; artist: string; durationSec: number }
  | { kind: 'ad'; durationSec: number; ad: Ad };

export interface Airing {
  item: LogItem;
  startMs: number;
  endMs: number;
}

export interface AdAiring {
  ad: Ad;
  startMs: number;
  endMs: number;
}

export interface OutboundMessage {
  channel: Channel;
  to: string;
  text: string;
  subject?: string;
  html?: string;
}

export interface DeliveryResult {
  channel: Channel;
  status: 'sent' | 'preview' | 'failed';
  detail: string;
}

export interface Provider {
  readonly live: boolean;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

export interface Profile {
  phone?: string;
  email?: string;
  defaultChannels: Channel[];
}
