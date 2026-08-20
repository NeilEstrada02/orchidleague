import 'dotenv/config';
import { createClient } from 'redis';

if (!process.env.REDIS_URL) {
  console.error('Missing REDIS_URL. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

export const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
await redisClient.connect();
