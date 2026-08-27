import { redisClient } from './redis.js';

const KEY = 'orchid:settings';
const DEFAULTS = {
  signupsOpen: true,
  dummyAccountsEnabled: false,
  discordRoleId: null,
  discordReminderChannelId: null,
};

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

export async function setDummyAccountsEnabled(enabled) {
  const settings = await getSettings();
  settings.dummyAccountsEnabled = enabled;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function setDiscordRoleId(roleId) {
  const settings = await getSettings();
  settings.discordRoleId = roleId;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function setDiscordReminderChannelId(channelId) {
  const settings = await getSettings();
  settings.discordReminderChannelId = channelId;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}
