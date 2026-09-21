import { redisClient } from './redis.js';

// Everything worth keeping. Sessions, the card cache, reminder claims, the
// audit log and past-season archives are separate and never rolled back.
export const BACKUP_KEYS = [
  'orchid:rounds',
  'orchid:users',
  'orchid:teams',
  'orchid:settings',
  'orchid:bracket',
  'orchid:hallOfFame',
];

const INDEX_KEY = 'orchid:backup:index';
const backupKey = (id) => `orchid:backup:${id}`;
const RETAIN_NIGHTLY = 14;
const RETAIN_OTHER = 25;
const NIGHTLY_INTERVAL_MS = 23 * 60 * 60 * 1000;

async function loadIndex() {
  const raw = await redisClient.get(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function listBackups() {
  return loadIndex();
}

// reason: 'nightly' | 'manual' | 'pre-advance' | 'pre-reset' | ... -- anything
// other than nightly shares one retention pool.
// minIntervalMs: skip (returning null) if a backup with this reason was already
// made that recently, so a failure that retries every minute can't flood the
// retention pool and push out older backups.
export async function createBackup(reason, note = '', { minIntervalMs = 0 } = {}) {
  if (minIntervalMs > 0) {
    const recent = (await loadIndex()).find((entry) => entry.reason === reason);
    if (recent && Date.now() - new Date(recent.createdAt).getTime() < minIntervalMs) return null;
  }
  const values = await redisClient.mGet(BACKUP_KEYS);
  const data = Object.fromEntries(BACKUP_KEYS.map((key, i) => [key, values[i]]));
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${reason}`;
  const payload = JSON.stringify({ id, createdAt, reason, note, data });
  await redisClient.set(backupKey(id), payload);

  const index = [{ id, createdAt, reason, note, bytes: payload.length }, ...(await loadIndex())];
  const kept = [];
  const counts = { nightly: 0, other: 0 };
  for (const entry of index) {
    const pool = entry.reason === 'nightly' ? 'nightly' : 'other';
    counts[pool]++;
    if (counts[pool] <= (pool === 'nightly' ? RETAIN_NIGHTLY : RETAIN_OTHER)) kept.push(entry);
    else await redisClient.del(backupKey(entry.id));
  }
  await redisClient.set(INDEX_KEY, JSON.stringify(kept));
  return kept[0];
}

export async function getBackup(id) {
  const index = await loadIndex();
  if (!index.some((entry) => entry.id === id)) return null;
  const raw = await redisClient.get(backupKey(id));
  return raw ? JSON.parse(raw) : null;
}

// Puts every backed-up key back the way it was. The current state is backed up
// first, so a restore can itself be undone.
export async function restoreBackup(id) {
  const backup = await getBackup(id);
  if (!backup) return null;
  await createBackup('pre-restore', `before restoring ${id}`);
  for (const key of BACKUP_KEYS) {
    const raw = backup.data[key];
    if (raw === null || raw === undefined) await redisClient.del(key);
    else await redisClient.set(key, raw);
  }
  return backup;
}

// Called from the production timer; makes at most one nightly backup per day
// even with overlapping processes.
export async function ensureNightlyBackup() {
  const last = (await loadIndex()).find((entry) => entry.reason === 'nightly');
  if (last && Date.now() - new Date(last.createdAt).getTime() < NIGHTLY_INTERVAL_MS) return null;
  const lockKey = `orchid:backup:lock:${new Date().toISOString().slice(0, 10)}`;
  const claimed = await redisClient.sAdd(lockKey, 'nightly');
  await redisClient.expire(lockKey, 60 * 60 * 48);
  if (claimed !== 1) return null;
  return createBackup('nightly');
}
