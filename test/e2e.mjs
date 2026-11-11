// End-to-end check of the demo in a real browser, in preview mode (no vendor keys).
// Run with: npm run e2e
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright is not a project dependency (see README); use whichever copy is installed.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

function check(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port) };
env.PROFILE_PATH = join(mkdtempSync(join(tmpdir(), 'radio-e2e-')), 'profile.json');
for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'RESEND_API_KEY', 'RESEND_FROM']) {
  env[key] = '';
}
// Run node directly (not via npx) so killing this child really stops the server.
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: root, env, stdio: 'inherit' });

let browser;
let exitCode = 0;
try {
  await waitForServer(`${base}/api/now-playing`);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(base);

  const banner = page.locator('#banner');
  const messages = page.locator('#phone-messages .message');

  // 1. Opening song: no ad card, no way to send.
  await page.locator('#now-title').waitFor();
  check(await page.locator('#ad-card').isHidden(), 'ad card is hidden during the opening song');
  check(await page.locator('#send-last').isHidden(), 'Send last ad is hidden before any ad has aired');

  // 2. Setup.
  await page.fill('#setup-form [name=phone]', '555-0100');
  await page.click('#setup-form button[type=submit]');
  await page.locator('#error-phone:not(:empty)').waitFor();
  check(true, 'an invalid phone number shows a field error');
  await page.fill('#setup-form [name=phone]', '+15555550100');
  await page.click('#setup-form button[type=submit]');
  await page.locator('#setup-status', { hasText: 'Saved' }).waitFor();
  check((await page.locator('#badge-sms').innerText()).includes('Preview'), 'text channel shows a Preview mode badge');

  // 3. The ad comes on air.
  await page.locator('#ad-card').waitFor({ state: 'visible', timeout: 40_000 });
  check((await page.locator('#send-phone').innerText()).trim() === 'Send to phone', 'ad card shows a Send to phone button');
  const advertiser = (await page.locator('#ad-advertiser').innerText()).trim();
  check(advertiser.length > 0, `ad card names the advertiser (${advertiser})`);

  // 4. One tap sends it.
  await page.click('#send-phone');
  await banner.filter({ hasText: 'Sent to your phone' }).waitFor();
  await messages.first().waitFor();
  check((await messages.count()) === 1, 'one message appears on the phone');
  const text = await messages.first().innerText();
  check(text.includes(advertiser), 'the message names the advertiser');
  check(text.includes('https://example.com/'), 'the message includes the website');
  check(/preview/i.test(text), 'the message is labelled preview');

  // 5. Pressing again does not send twice.
  await page.click('#send-phone');
  await banner.filter({ hasText: 'Already sent' }).waitFor();
  check((await messages.count()) === 1, 'a second tap does not send a second message');

  // 6. Voice: asking for email with no email saved sends nothing.
  await page.locator('.phrase-chip', { hasText: 'Send to my email' }).click();
  await banner.filter({ hasText: 'Add your email address in Setup first' }).waitFor();
  check((await messages.count()) === 1, 'asking for email with no email saved sends nothing');

  // 7. Voice: "Send me this ad" goes by the default channel, already sent.
  await page.locator('.phrase-chip', { hasText: 'Send me this ad' }).click();
  await banner.filter({ hasText: 'Already sent' }).waitFor();
  check(true, 'a voice command is recognised and deduplicated');

  // 8. After the grace period the card goes away; the wheel button finds no ad.
  await page.locator('#ad-card').waitFor({ state: 'hidden', timeout: 60_000 });
  check(await page.locator('#send-last').isVisible(), 'Send last ad is offered once the card is gone');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await banner.filter({ hasText: 'No ad playing right now' }).waitFor();
  check(true, 'the steering wheel button reports no ad during a song');
  await page.click('#send-last');
  await banner.filter({ hasText: 'Already sent' }).waitFor();
  check((await messages.count()) === 1, 'Send last ad finds the same ad and does not resend');

  check(pageErrors.length === 0, `no page errors (${pageErrors.join('; ') || 'none'})`);
  console.log('\nEnd-to-end: all checks passed');
} catch (err) {
  console.error(`\n${err.message}`);
  exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
process.exit(exitCode);
