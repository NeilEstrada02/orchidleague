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

// Gets the league role's ID, creating it in the guild the first time it's
// needed. The bot's own role must sit above this role in the server's role
// list, or Discord will refuse to let it assign/remove it.
export async function ensureLeagueRole() {
  if (!botConfigured()) return null;
  const settings = await getSettings();
  if (settings.discordRoleId) return settings.discordRoleId;

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
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
  if (!botConfigured()) return;
  const roleId = await ensureLeagueRole();
  if (!roleId) return;
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
      { method: 'PUT', headers: botHeaders() }
    );
    if (!res.ok) {
      console.error(`Failed to add Discord role to ${discordUserId}:`, res.status, await res.text());
    }
  } catch (err) {
    console.error(`Failed to add Discord role to ${discordUserId}:`, err);
  }
}

export async function removeRoleFromMember(discordUserId) {
  if (!botConfigured()) return;
  const roleId = await ensureLeagueRole();
  if (!roleId) return;
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
      { method: 'DELETE', headers: botHeaders() }
    );
    if (!res.ok) {
      console.error(`Failed to remove Discord role from ${discordUserId}:`, res.status, await res.text());
    }
  } catch (err) {
    console.error(`Failed to remove Discord role from ${discordUserId}:`, err);
  }
}

// Full reconciliation pass: makes sure every currently-enrolled user has the
// role. Used for the initial rollout and to catch any drift.
export async function syncAllRoles(enrolledUsers) {
  if (!botConfigured()) {
    return { synced: 0, skipped: true };
  }
  const roleId = await ensureLeagueRole();
  if (!roleId) {
    return { synced: 0, skipped: true };
  }
  let synced = 0;
  for (const user of enrolledUsers) {
    await addRoleToMember(user.id);
    synced++;
  }
  return { synced, skipped: false };
}

export function isDiscordBotConfigured() {
  return botConfigured();
}
