import { redisClient } from './redis.js';

const KEY = 'orchid:audit';
const MAX_ENTRIES = 300;

async function load() {
  const raw = await redisClient.get(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Record of admin actions that change league data, newest first. `actor` is
// the acting user (or null for the system); `details` should hold enough to
// understand -- and by hand reverse -- the change.
export async function logAudit(actor, action, details = {}) {
  const entries = await load();
  entries.unshift({
    at: new Date().toISOString(),
    actor: actor ? { id: actor.id, name: actor.displayName } : null,
    action,
    details,
  });
  await redisClient.set(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export async function getAudit(limit = 50) {
  return (await load()).slice(0, limit);
}
