import { redisClient } from './redis.js';

const keyFor = (roundNumber) => `orchid:thread:round:${roundNumber}`;
const TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days -- well past any round's lifetime

export async function getRoundThreadId(roundNumber) {
  return redisClient.get(keyFor(roundNumber));
}

export async function setRoundThreadId(roundNumber, threadId) {
  await redisClient.set(keyFor(roundNumber), threadId, { EX: TTL_SECONDS });
}
