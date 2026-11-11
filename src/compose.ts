import type { Ad } from './types.js';

export const SMS_MAX = 320;

function smsLines(ad: Ad, offer: string, station: string): string[] {
  return [
    `${ad.advertiser}: ${offer}`,
    ...(ad.promoCode ? [`Code: ${ad.promoCode}`] : []),
    ad.url,
    `Call ${ad.phone}`,
    `Heard on ${station}`,
  ];
}

/** One text message, at most SMS_MAX characters. Only the offer is ever shortened. */
export function composeSms(ad: Ad, station: string): string {
  const full = smsLines(ad, ad.offer, station).join('\n');
  if (full.length <= SMS_MAX) return full;
  const room = Math.max(0, ad.offer.length - (full.length - SMS_MAX) - 1);
  const shortened = ad.offer.slice(0, room).trimEnd() + '…';
  return smsLines(ad, shortened, station).join('\n').slice(0, SMS_MAX);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function composeEmail(
  ad: Ad,
  station: string,
  heardAtMs: number,
): { subject: string; text: string; html: string } {
  const heard = new Date(heardAtMs).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const rows: Array<[string, string]> = [
    ['Website', ad.url],
    ['Phone', ad.phone],
    ...(ad.promoCode ? ([['Promo code', ad.promoCode]] as Array<[string, string]>) : []),
    ...(ad.expires ? ([['Offer ends', ad.expires]] as Array<[string, string]>) : []),
  ];

  const text = [
    ad.advertiser,
    ad.headline,
    '',
    ad.offer,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Heard on ${station} at ${heard}.`,
    'You asked for this ad to be sent to you from your car.',
  ].join('\n');

  const e = escapeHtml;
  const html = [
    '<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5">',
    `<p style="margin:0;color:#666;font-size:13px">${e(ad.advertiser)}</p>`,
    `<h1 style="margin:4px 0 12px;font-size:22px">${e(ad.headline)}</h1>`,
    `<p>${e(ad.offer)}</p>`,
    '<table style="border-collapse:collapse">',
    ...rows.map(([label, value]) => {
      const shown =
        label === 'Website' ? `<a href="${e(value)}">${e(value)}</a>` : e(value);
      return `<tr><td style="padding:4px 16px 4px 0;color:#666">${e(label)}</td><td>${shown}</td></tr>`;
    }),
    '</table>',
    `<p style="color:#666;font-size:13px">Heard on ${e(station)} at ${e(heard)}. You asked for this ad to be sent to you from your car.</p>`,
    '</div>',
  ].join('');

  return { subject: `${ad.advertiser}: ${ad.headline}`, text, html };
}
