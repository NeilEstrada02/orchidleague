import { redisClient } from './redis.js';

const HOF_KEY = 'orchid:hallOfFame';
const ARCHIVE_INDEX_KEY = 'orchid:archives';

// Seasons before the site kept its own history.
const DEFAULT_HALL_OF_FAME = [
  { season: 3, champion: 'Curve Fillers', members: ['Neil Estrada', 'Liam Etelson', 'Zev Goldhaber-Gordon'] },
  { season: 2, champion: 'Frank Kaner', handle: '@_adlai' },
  { season: 1, champion: 'Julian Weiswasser', handle: '@selfcongrats' },
];

async function loadJson(key, fallback) {
  const raw = await redisClient.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---------- Hall of Fame ----------

export async function getHallOfFame() {
  const entries = await loadJson(HOF_KEY, DEFAULT_HALL_OF_FAME);
  return [...entries].sort((a, b) => b.season - a.season);
}

export async function upsertHallOfFame(entry) {
  const entries = (await getHallOfFame()).filter((e) => e.season !== entry.season);
  entries.push(entry);
  entries.sort((a, b) => b.season - a.season);
  await redisClient.set(HOF_KEY, JSON.stringify(entries));
  return entries;
}

export async function removeHallOfFame(season) {
  const entries = (await getHallOfFame()).filter((e) => e.season !== season);
  await redisClient.set(HOF_KEY, JSON.stringify(entries));
  return entries;
}

// ---------- Season archives ----------
// A full, self-contained copy of a season (rounds, bracket, standings, names),
// kept permanently and never rolled back by a restore.

const archiveKey = (season, archivedAt) => `orchid:archive:${season}:${archivedAt.replace(/[:.]/g, '-')}`;

export async function saveArchive(archive) {
  const key = archiveKey(archive.season, archive.archivedAt);
  await redisClient.set(key, JSON.stringify(archive));
  const index = await loadJson(ARCHIVE_INDEX_KEY, []);
  // The index carries the small final-standings table so the Hall of Fame can
  // show it without loading the whole archive.
  index.unshift({
    season: archive.season,
    archivedAt: archive.archivedAt,
    key,
    champion: archive.champion?.name ?? null,
    standings: archive.standings.map(({ rank, name, members, wins, losses }) => ({ rank, name, members, wins, losses })),
  });
  await redisClient.set(ARCHIVE_INDEX_KEY, JSON.stringify(index));
  return key;
}

export async function listArchives() {
  return loadJson(ARCHIVE_INDEX_KEY, []);
}

// The most recent archive saved for a season, or null.
export async function getArchive(season) {
  const entry = (await listArchives()).find((a) => a.season === season);
  return entry ? loadJson(entry.key, null) : null;
}
