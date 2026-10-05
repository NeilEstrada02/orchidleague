import { redisClient } from './redis.js';
import { getAllTeams } from './teamStore.js';
import { getAllUsers } from './userStore.js';
import { addRoleToMember, removeRoleFromMember, isDiscordBotConfigured } from './discordBot.js';
import { logAudit } from './auditStore.js';
import { ELIMINATION_LOSSES } from './seasonFlow.js';

// Players whose league role we took away because their team was eliminated.
// Tracked so that if a correction later un-eliminates their team (or a new
// season resets everyone), exactly those players get the role back -- and
// nobody whose role was handled by hand is touched.
const KEY = 'orchid:roleRemoved';
const PAUSE_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let running = false;

// Brings Discord in line with the standings: everyone on an eliminated team
// (3 losses in closed rounds) loses the league role, once. Idempotent, so it's
// safe to call as often as needed; it only makes API calls for players whose
// status has changed. Role removal only -- nothing else about the player.
export async function syncEliminatedRoles() {
  if (running || !isDiscordBotConfigured()) return null;
  running = true;
  try {
    const [teams, users, trackedIds] = await Promise.all([getAllTeams(), getAllUsers(), redisClient.sMembers(KEY)]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const enrolled = (id) => Boolean(userById.get(id)?.enrolled);

    const eliminated = new Set();
    for (const team of teams) {
      if ((team.losses ?? 0) >= ELIMINATION_LOSSES) for (const id of [team.captainId, ...team.memberIds]) eliminated.add(id);
    }
    const tracked = new Set(trackedIds);
    const toRemove = [...eliminated].filter((id) => enrolled(id) && !tracked.has(id));
    const toRestore = [...tracked].filter((id) => !eliminated.has(id));
    if (toRemove.length === 0 && toRestore.length === 0) return { removed: [], restored: [], failed: 0 };

    const removed = [];
    const restored = [];
    let failed = 0;
    for (const id of toRemove) {
      if (await removeRoleFromMember(id)) {
        await redisClient.sAdd(KEY, id);
        removed.push(userById.get(id)?.displayName ?? id);
      } else {
        failed++;
      }
      await sleep(PAUSE_MS);
    }
    for (const id of toRestore) {
      // Someone who has since un-enrolled shouldn't get the role back.
      if (!enrolled(id) || (await addRoleToMember(id))) {
        await redisClient.sRem(KEY, id);
        if (enrolled(id)) restored.push(userById.get(id)?.displayName ?? id);
      } else {
        failed++;
      }
      await sleep(PAUSE_MS);
    }

    if (removed.length > 0 || restored.length > 0) {
      await logAudit(null, 'sync_eliminated_roles', { removed, restored });
      console.log(`Eliminated-team roles: removed ${removed.length}, restored ${restored.length}, failed ${failed}.`);
    }
    return { removed, restored, failed };
  } finally {
    running = false;
  }
}
