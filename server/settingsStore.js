import { cachedGet, freshGet, cachedSet } from './cache.js';
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

// Readers use the short-lived cache; setters read fresh.
async function readSettings(fresh) {
  const raw = fresh ? await freshGet(KEY) : await cachedGet(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function getSettings() {
  return readSettings(false);
}

export async function setSignupsOpen(open) {
  const settings = await readSettings(true);
  settings.signupsOpen = open;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function setDummyAccountsEnabled(enabled) {
  const settings = await readSettings(true);
  settings.dummyAccountsEnabled = enabled;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function setSeasonNumber(number) {
  const settings = await readSettings(true);
  settings.seasonNumber = number;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function setFirstRound(firstRound) {
  const settings = await readSettings(true);
  settings.firstRound = firstRound;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

// weeks 0 removes the extension.
export async function setRoundExtension(roundNumber, weeks) {
  const settings = await readSettings(true);
  const next = { ...(settings.roundExtensions ?? {}) };
  if (weeks > 0) next[roundNumber] = weeks;
  else delete next[roundNumber];
  settings.roundExtensions = next;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function clearRoundExtensions() {
  const settings = await readSettings(true);
  settings.roundExtensions = {};
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function setPlannedCutSize(size) {
  const settings = await readSettings(true);
  settings.plannedCutSize = size;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

export async function setDiscordRoleId(roleId) {
  const settings = await readSettings(true);
  settings.discordRoleId = roleId;
  await cachedSet(KEY, JSON.stringify(settings));
  return settings;
}

