import { redisClient } from './redis.js';

const KEY = 'orchid:bracket';

// { size, startedAt, seeds: [{ seed, captainId }], championId, completedAt }
export async function getBracket() {
  const raw = await redisClient.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveBracket(bracket) {
  await redisClient.set(KEY, JSON.stringify(bracket));
}

export async function clearBracket() {
  await redisClient.del(KEY);
}

export const CUT_SIZES = [2, 4, 8];

// Order seeds so that winners of adjacent matches meet in the next round:
// 4 -> [1,4,2,3] (1v4, 2v3); 8 -> [1,8,4,5,2,7,3,6] (1v8, 4v5, 2v7, 3v6).
export function seedOrder(size) {
  let order = [1, 2];
  for (let n = 4; n <= size; n *= 2) order = order.flatMap((seed) => [seed, n + 1 - seed]);
  return order;
}

export function roundLabel(teamsRemaining) {
  if (teamsRemaining === 2) return 'Finals';
  if (teamsRemaining === 4) return 'Semifinals';
  if (teamsRemaining === 8) return 'Quarterfinals';
  return `Round of ${teamsRemaining}`;
}

// The team that advances from a played playoff pairing.
export function winnerOf(pairing) {
  return pairing.result === 'B' ? pairing.teamB : pairing.teamA;
}
