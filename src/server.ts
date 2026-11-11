import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createCapture } from './capture.js';
import { createProviders } from './delivery/index.js';
import { createProfileStore } from './profile.js';
import { STATION_NAME, createSchedule, loadBroadcastLog } from './schedule.js';

const root = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

const port = Number(process.env.PORT) || 3000;
const providers = createProviders(process.env);
const schedule = createSchedule(loadBroadcastLog(), Date.now());

const app = createApp({
  schedule,
  capture: createCapture(schedule),
  providers,
  profiles: createProfileStore(process.env.PROFILE_PATH || `${root}data/profile.json`),
  now: () => Date.now(),
  station: STATION_NAME,
  publicDir: `${root}public`,
});

app.listen(port, () => {
  const mode = (live: boolean) => (live ? 'live' : 'preview mode (no keys set)');
  console.log(`Radio ad capture demo: http://localhost:${port}`);
  console.log(`  Text messages: ${mode(providers.sms.live)}`);
  console.log(`  Email:         ${mode(providers.email.live)}`);
});
