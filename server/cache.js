import { redisClient } from './redis.js';

// A short-lived, write-through cache for the few large JSON documents the app
// reads constantly (rounds, users, teams, settings, backup index). Every page
// load and every background tick used to re-download all of them; now they're
// fetched at most once per TTL.
//
// - Reads may come from the cache. Anything that modifies data must read
//   fresh (freshGet) so it never builds on a stale copy.
// - Writes go to Redis and the cache together, so this server always sees its
//   own changes immediately. Only a change made by something else (a one-off
//   script, a second instance during a deploy) can take up to TTL to show up.
// - If Redis can't be reached, a stale copy is served rather than an error.
const TTL_MS = 3 * 60 * 1000;
const entries = new Map(); // key -> { raw, at }
const inflight = new Map(); // key -> Promise<string | null>

export async function cachedGet(key) {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.raw;
  if (inflight.has(key)) return inflight.get(key);

  const request = redisClient
    .get(key)
    .then((raw) => {
      entries.set(key, { raw, at: Date.now() });
      return raw;
    })
    .catch((err) => {
      if (hit) return hit.raw;
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export async function freshGet(key) {
  const raw = await redisClient.get(key);
  entries.set(key, { raw, at: Date.now() });
  return raw;
}

export async function cachedSet(key, raw) {
  await redisClient.set(key, raw);
  entries.set(key, { raw, at: Date.now() });
}

export function dropCached(...keys) {
  for (const key of keys) entries.delete(key);
}
