import 'dotenv/config';
import { createClient } from 'redis';

if (!process.env.REDIS_URL) {
  console.error('Missing REDIS_URL. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

export const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err?.message ?? err));

// Keeps trying until the database accepts the connection -- including when
// it's refusing everything (e.g. a plan limit) -- instead of crashing the
// whole site. Not awaited, so the server starts right away and answers
// API requests with a 503 until this succeeds.
let attempt = 0;
async function connectUntilReady() {
  for (;;) {
    attempt++;
    try {
      await redisClient.connect();
      console.log(`Redis connected${attempt > 1 ? ` (after ${attempt} attempts)` : ''}.`);
      return;
    } catch (err) {
      console.error(`Redis connection failed (attempt ${attempt}): ${err?.message ?? err}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000 * attempt, 30000)));
    }
  }
}
connectUntilReady();

export const isRedisReady = () => redisClient.isReady;
