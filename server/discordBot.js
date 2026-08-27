import { getSettings, setDiscordRoleId } from './settingsStore.js';

const DISCORD_API = 'https://discord.com/api/v10';
const ROLE_NAME = 'Orchid League';

function botConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps a Discord REST call with 429 handling: waits the server-specified
// retry_after and tries again, up to a few attempts, instead of silently
// dropping the request the way a single fetch would.
async function discordFetch(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    const body = await res.json().catch(() => ({}));
    const retryAfterMs = Math.ceil((body.retry_after ?? 1) * 1000) + 50;
    await sleep(retryAfterMs);
  }
  return fetch(url, options);
}

// Gets the league role's ID, creating it in the guild the first time it's
// needed. The bot's own role must sit above this role in the server's role
// list, or Discord will refuse to let it assign/remove it.
export async function ensureLeagueRole() {
  if (!botConfigured()) return null;
  const settings = await getSettings();
  if (settings.discordRoleId) return settings.discordRoleId;

  try {
    const res = await discordFetch(`${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ name: ROLE_NAME, mentionable: true }),
    });
    if (!res.ok) {
      console.error('Failed to create Discord role:', res.status, await res.text());
      return null;
    }
    const role = await res.json();
    await setDiscordRoleId(role.id);
    return role.id;
  } catch (err) {
    console.error('Failed to create Discord role:', err);
    return null;
  }
}

export async function addRoleToMember(discordUserId) {
  if (!botConfigured()) return false;
  const roleId = await ensureLeagueRole();
  if (!roleId) return false;
  try {
    const res = await discordFetch(
      `${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
      { method: 'PUT', headers: botHeaders() }
    );
    if (!res.ok) {
      console.error(`Failed to add Discord role to ${discordUserId}:`, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Failed to add Discord role to ${discordUserId}:`, err);
    return false;
  }
}

export async function removeRoleFromMember(discordUserId) {
  if (!botConfigured()) return false;
  const roleId = await ensureLeagueRole();
  if (!roleId) return false;
  try {
    const res = await discordFetch(
      `${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
      { method: 'DELETE', headers: botHeaders() }
    );
    if (!res.ok) {
      console.error(`Failed to remove Discord role from ${discordUserId}:`, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Failed to remove Discord role from ${discordUserId}:`, err);
    return false;
  }
}

// Full reconciliation pass: makes sure every currently-enrolled user has the
// role. Used for the initial rollout and to catch any drift. Paced with a
// small delay between members to stay under Discord's per-route rate limit
// rather than firing everything at once.
export async function syncAllRoles(enrolledUsers) {
  if (!botConfigured()) {
    return { synced: 0, failed: 0, skipped: true };
  }
  const roleId = await ensureLeagueRole();
  if (!roleId) {
    return { synced: 0, failed: 0, skipped: true };
  }
  let synced = 0;
  let failed = 0;
  for (const user of enrolledUsers) {
    const ok = await addRoleToMember(user.id);
    if (ok) synced++;
    else failed++;
    await sleep(300);
  }
  return { synced, failed, skipped: false };
}

// Leaves headroom under Discord's 2000-character message cap.
const MAX_CONTENT_LENGTH = 1800;

export async function sendChannelMessage(channelId, content, mentionUserIds = []) {
  if (!botConfigured()) return { ok: false, error: 'not_configured' };
  try {
    const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [], users: mentionUserIds },
      }),
    });
    if (!res.ok) {
      console.error('Failed to send Discord message:', res.status, await res.text());
      return { ok: false, error: 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('Failed to send Discord message:', err);
    return { ok: false, error: 'send_failed' };
  }
}

// Sends one or more @-mention reminder messages (chunked to stay under
// Discord's character limit) to every given user ID.
export async function sendDecklistReminder(channelId, userIds, siteUrl) {
  if (!botConfigured()) return { ok: false, error: 'not_configured' };
  const prefix = `⏰ Decklist reminder — you haven't submitted a decklist yet. Please add one on ${siteUrl} before the next round: `;

  const chunks = [];
  let current = [];
  let currentLength = prefix.length;
  for (const id of userIds) {
    const mention = `<@${id}> `;
    if (currentLength + mention.length > MAX_CONTENT_LENGTH && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLength = prefix.length;
    }
    current.push(id);
    currentLength += mention.length;
  }
  if (current.length > 0) chunks.push(current);

  for (const chunk of chunks) {
    const content = prefix + chunk.map((id) => `<@${id}>`).join(' ');
    const result = await sendChannelMessage(channelId, content, chunk);
    if (!result.ok) return result;
    await sleep(400);
  }
  return { ok: true, messageCount: chunks.length };
}

export function isDiscordBotConfigured() {
  return botConfigured();
}
