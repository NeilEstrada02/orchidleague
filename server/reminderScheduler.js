import { redisClient } from './redis.js';

// Hours before the results deadline at which an automatic reminder goes out.
export const REMINDER_HOURS = [48, 24, 12, 6, 3];

const HOUR_MS = 60 * 60 * 1000;
// A reminder only fires while we're within this long after its threshold.
// If the moment was missed (e.g. a round generated with only 5h left, or a
// long outage), it's skipped rather than sent late and out of context.
const GRACE_MS = 30 * 60 * 1000;

// Returns the reminder (in hours) that is due right now, or null.
export function pickDueReminder(msUntilDeadline) {
  for (const hours of REMINDER_HOURS) {
    const threshold = hours * HOUR_MS;
    if (msUntilDeadline <= threshold && msUntilDeadline > threshold - GRACE_MS) return hours;
  }
  return null;
}

const keyFor = (roundNumber) => `orchid:reminders:round:${roundNumber}`;

// Atomically records that this reminder is being handled. SADD returns 1 only
// for the first caller, so overlapping processes (a deploy overlap, a stray
// second instance) can't both send it.
// `kind` is the reminder's hours threshold, or 'announce' for the new-round ping.
export async function claimReminder(roundNumber, kind) {
  const key = keyFor(roundNumber);
  const added = await redisClient.sAdd(key, String(kind));
  await redisClient.expire(key, 60 * 60 * 24 * 30);
  return added === 1;
}

export async function releaseReminder(roundNumber, kind) {
  await redisClient.sRem(keyFor(roundNumber), String(kind));
}
