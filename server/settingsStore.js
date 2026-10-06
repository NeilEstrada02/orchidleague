import { redisClient } from './redis.js';
import { DEFAULT_FIRST_ROUND } from './schedule.js';

const KEY = 'orchid:settings';
const DEFAULTS = {
  signupsOpen: true,
  dummyAccountsEnabled: false,
  discordRoleId: null,
  // Seasons 1-3 are already in the Hall of Fame; this one is the fourth.
  seasonNumber: 4,
  // Eastern wall-clock date/time of Round 1 (later rounds follow weekly), or
  // null when the season isn't scheduled yet -- rounds then start by hand only.
  firstRound: DEFAULT_FIRST_ROUND,
  // Extra weeks an admin has given rounds: { [roundNumber]: weeks }.
  roundExtensions: {},
  // When set (2, 4 or 8), the next automatic round start begins a top cut of
  // that size instead of another Swiss round.
  plannedCutSize: null,
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

export async function setSeasonNumber(number) {
  const settings = await getSettings();
  settings.seasonNumber = number;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function setFirstRound(firstRound) {
  const settings = await getSettings();
  settings.firstRound = firstRound;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

// weeks 0 removes the extension.
export async function setRoundExtension(roundNumber, weeks) {
  const settings = await getSettings();
  const next = { ...(settings.roundExtensions ?? {}) };
  if (weeks > 0) next[roundNumber] = weeks;
  else delete next[roundNumber];
  settings.roundExtensions = next;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function clearRoundExtensions() {
  const settings = await getSettings();
  settings.roundExtensions = {};
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function setPlannedCutSize(size) {
  const settings = await getSettings();
  settings.plannedCutSize = size;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

export async function setDiscordRoleId(roleId) {
  const settings = await getSettings();
  settings.discordRoleId = roleId;
  await redisClient.set(KEY, JSON.stringify(settings));
  return settings;
}

