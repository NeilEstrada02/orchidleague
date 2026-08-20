import { redisClient } from './redis.js';

const KEY = 'orchid:settings';
const DEFAULTS = { signupsOpen: true };

export async function getSettings() {
  const raw = await redisClient.get(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setSignupsOpen(open) {
  const settings = await getSettings();
  settings.signupsOpen = open;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}
