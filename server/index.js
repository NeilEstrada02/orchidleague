import express from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { redisClient } from './redis.js';
import { recordLogin, getUser, getAllUsers, setEnrollment, getEnrolledUsers, setCaptain, setDecklist } from './userStore.js';
import {
  getTeam,
  getAllTeams,
  isMemberOfAnyTeam,
  addMember,
  removeMember,
  disbandTeam,
  removeMemberEverywhere,
  ensureTeam,
  setTeamInfo,
  swapSeats,
  setPaid,
  SEATS,
  applyRoundResults,
  resetAllRecords,
} from './teamStore.js';
import {
  getSettings,
  setSignupsOpen,
  setDummyAccountsEnabled,
} from './settingsStore.js';
import { seedDummyAccounts, clearDummyAccounts } from './dummyAccounts.js';
import {
  getRounds,
  getCurrentRound,
  closeCurrentRound,
  generateNextRound,
  reportResult,
  resetRounds,
  backfillCurrentRoundSeats,
  computeTiebreakers,
} from './pairingStore.js';
import { getRoundStartTime } from './schedule.js';
import { pickDueReminder, claimReminder, releaseReminder } from './reminderScheduler.js';
import {
  addRoleToMember,
  removeRoleFromMember,
  sendDecklistReminder,
  sendResultReminder,
  sendNewRoundAnnouncement,
  ensureLeagueRole,
  isDiscordBotConfigured,
} from './discordBot.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  DISCORD_GUILD_ID,
  SESSION_SECRET,
  CLIENT_URL = 'http://localhost:5173',
  PORT = 3001,
  NODE_ENV,
} = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI || !SESSION_SECRET || !DISCORD_GUILD_ID) {
  console.error('Missing required env vars. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

const isProduction = NODE_ENV === 'production';
const ELIMINATION_LOSSES = 3;
const REMINDER_CHANNEL_ID = '1375356544417271900'; // #league-announcements
const autoRemindersActive = isProduction || process.env.RENDER === 'true';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(
  session({
    store: new RedisStore({ client: redisClient, prefix: 'orchid:sess:' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// Advances rounds automatically on schedule. It runs on the production timer
// (every minute) and also on every incoming request (fired in the background,
// never blocking the response) as a fallback, so a scheduled boundary is
// caught up even if the process was restarted. The in-process lock just
// prevents concurrent triggers from double-advancing.
let autoAdvanceInProgress = false;
async function maybeAutoAdvance() {
  if (autoAdvanceInProgress) return;
  autoAdvanceInProgress = true;
  try {
    const rounds = await getRounds();
    let currentCount = rounds.length;
    const now = Date.now();

    while (getRoundStartTime(currentCount + 1).getTime() <= now) {
      const closeResult = await closeCurrentRound();
      if (closeResult.deltas.length > 0) {
        await applyRoundResults(closeResult.deltas);
      }
      const allTeams = await getAllTeams();
      const eligible = allTeams.filter((t) => t.memberIds.length === 2 && (t.losses ?? 0) < ELIMINATION_LOSSES);
      if (eligible.length < 2) break;
      const allUsers = await getAllUsers();
      const decklistsById = new Map(allUsers.map((u) => [u.id, u.decklist ?? '']));
      await generateNextRound(eligible, decklistsById);
      currentCount++;
    }
  } finally {
    autoAdvanceInProgress = false;
  }
}

app.use((req, res, next) => {
  maybeAutoAdvance().catch((err) => console.error('Auto-advance check failed:', err));
  next();
});

// Every match in the round with no reported result yet, with both full
// teams' Discord IDs so anyone involved gets pinged.
async function getUnreportedMatches(round) {
  const unreported = round.pairings.filter((p) => p.teamB && !p.result);
  const matches = await Promise.all(
    unreported.map(async (p) => {
      const [teamA, teamB, captainA, captainB] = await Promise.all([
        getTeam(p.teamA),
        getTeam(p.teamB),
        getUser(p.teamA),
        getUser(p.teamB),
      ]);
      const teamAName = teamA?.teamName || `${captainA?.displayName ?? 'Unknown'}'s Team`;
      const teamBName = teamB?.teamName || `${captainB?.displayName ?? 'Unknown'}'s Team`;
      const mentionIds = [p.teamA, ...(teamA?.memberIds ?? []), p.teamB, ...(teamB?.memberIds ?? [])];
      return { teamAName, teamBName, mentionIds };
    })
  );
  const teamCount = new Set(unreported.flatMap((p) => [p.teamA, p.teamB])).size;
  return { matches, teamCount };
}

// Pings the league role once when a round is generated on its schedule.
// Only a round created at/after its own scheduled start (i.e. by the
// automatic advance) and still fresh qualifies, so an admin starting a round
// early by hand never pings everyone. Claimed atomically in Redis so it can
// never go out twice; if the send fails it's released and retried next tick.
let announceInProgress = false;
async function checkNewRoundAnnouncement() {
  if (announceInProgress || !isDiscordBotConfigured()) return;
  announceInProgress = true;
  try {
    const round = await getCurrentRound();
    if (!round?.createdAt) return;
    const createdMs = new Date(round.createdAt).getTime();
    const scheduledMs = getRoundStartTime(round.number).getTime();
    if (createdMs < scheduledMs || Date.now() - createdMs > 30 * 60 * 1000) return;
    if (!(await claimReminder(round.number, 'announce'))) return;

    const roleId = await ensureLeagueRole();
    const result = roleId
      ? await sendNewRoundAnnouncement(
          REMINDER_CHANNEL_ID,
          roleId,
          round.number,
          CLIENT_URL,
          getRoundStartTime(round.number + 1)
        )
      : { ok: false, error: 'no_role' };
    if (result.ok) {
      console.log(`Announced round ${round.number} to the league role.`);
    } else {
      console.error(`Failed to announce round ${round.number}:`, result.error);
      await releaseReminder(round.number, 'announce');
    }
  } finally {
    announceInProgress = false;
  }
}

// Automatic result reminders at 48/24/12/6/3 hours before the round's
// deadline (the moment the next round starts). Runs on a timer, and each
// reminder is claimed atomically in Redis first, so a restart or overlapping
// deploy can never send one twice.
let reminderCheckInProgress = false;
async function checkResultReminders() {
  if (reminderCheckInProgress || !isDiscordBotConfigured()) return;
  reminderCheckInProgress = true;
  try {
    const round = await getCurrentRound();
    if (!round) return;
    const deadline = getRoundStartTime(round.number + 1);
    const hours = pickDueReminder(deadline.getTime() - Date.now());
    if (hours === null) return;

    const { matches } = await getUnreportedMatches(round);
    if (matches.length === 0) return;
    if (!(await claimReminder(round.number, hours))) return;

    const result = await sendResultReminder(REMINDER_CHANNEL_ID, matches, CLIENT_URL, deadline, `${hours} hours`);
    if (result.ok) {
      console.log(`Sent ${hours}h result reminder for round ${round.number} (${matches.length} matches).`);
    } else {
      console.error(`Failed to send ${hours}h result reminder for round ${round.number}:`, result.error);
      // Nothing went out, so let the next tick retry (bounded by the grace
      // window). If some chunks did go out, keep the claim rather than duplicate them.
      if (!result.messageCount) await releaseReminder(round.number, hours);
    }
  } finally {
    reminderCheckInProgress = false;
  }
}

async function resolveTeam(team) {
  if (!team) return null;
  const captain = await getUser(team.captainId);
  const members = await Promise.all(
    team.memberIds.map(async (id) => ({ id, displayName: (await getUser(id))?.displayName ?? 'Unknown' }))
  );
  const rawSeats = team.seats ?? { pioneer: null, modern: null, standard: null };
  const seats = {};
  for (const seat of SEATS) {
    const personId = rawSeats[seat] ?? null;
    seats[seat] = personId ? { id: personId, displayName: (await getUser(personId))?.displayName ?? 'Unknown' } : null;
  }
  return {
    captainId: team.captainId,
    captainName: captain?.displayName ?? 'Unknown',
    teamName: team.teamName ?? '',
    charity: team.charity ?? '',
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    eliminated: (team.losses ?? 0) >= ELIMINATION_LOSSES,
    members,
    seats,
  };
}

async function resolveSeatsSnapshot(snapshot) {
  const result = {};
  for (const seat of SEATS) {
    const id = snapshot?.[seat] ?? null;
    result[seat] = id ? { id, displayName: (await getUser(id))?.displayName ?? 'Unknown' } : null;
  }
  return result;
}

async function getUserTeamCaptainId(userId) {
  const stored = await getUser(userId);
  if (stored?.isCaptain) return userId;
  const allTeams = await getAllTeams();
  const team = allTeams.find((t) => t.memberIds.includes(userId));
  return team?.captainId ?? null;
}

// Run whenever signups close: anyone enrolled but on no team (never
// captained or joined one) is removed from the league -- their Discord
// role goes with them, same as a normal self-unenroll.
async function removeTeamlessEnrolledUsers() {
  const [enrolled, allTeams] = await Promise.all([getEnrolledUsers(), getAllTeams()]);
  const onTeamIds = new Set(allTeams.flatMap((t) => [t.captainId, ...t.memberIds]));
  const teamless = enrolled.filter((u) => !onTeamIds.has(u.id));
  for (const u of teamless) {
    await setEnrollment(u.id, false);
    await removeRoleFromMember(u.id);
  }
  return teamless.map((u) => u.id);
}

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${CLIENT_URL}?error=missing_code`);

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`User fetch failed: ${userRes.status}`);
    const discordUser = await userRes.json();

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!guildsRes.ok) throw new Error(`Guilds fetch failed: ${guildsRes.status}`);
    const guilds = await guildsRes.json();
    const isMember = guilds.some((g) => g.id === DISCORD_GUILD_ID);
    if (!isMember) {
      return res.redirect(`${CLIENT_URL}?error=not_in_server`);
    }

    const sessionUser = {
      id: discordUser.id,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
    };

    req.session.user = sessionUser;
    await recordLogin(sessionUser);

    res.redirect(CLIENT_URL);
  } catch (err) {
    console.error(err);
    res.redirect(`${CLIENT_URL}?error=oauth_failed`);
  }
});

app.get('/api/me', async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const stored = await getUser(req.session.user.id);
  const myTeamCaptainId = await getUserTeamCaptainId(req.session.user.id);
  let team = myTeamCaptainId ? await resolveTeam(await getTeam(myTeamCaptainId)) : null;
  if (team) {
    // Only exposed here, to a member viewing their own team -- never via
    // the public /api/teams, since decklists stay hidden until a round locks
    // them in.
    team = {
      ...team,
      captainDecklist: (await getUser(team.captainId))?.decklist ?? '',
      members: await Promise.all(
        team.members.map(async (m) => ({ ...m, decklist: (await getUser(m.id))?.decklist ?? '' }))
      ),
    };
  }
  res.json({
    user: {
      ...req.session.user,
      enrolled: stored?.enrolled ?? false,
      isCaptain: stored?.isCaptain ?? false,
      isAdmin: stored?.isAdmin ?? false,
      team,
      myTeamCaptainId,
      decklist: stored?.decklist ?? '',
    },
  });
});

app.post('/api/decklist', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.enrolled) {
    return res.status(400).json({ error: 'must_be_enrolled' });
  }
  const { text } = req.body ?? {};
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'too_long' });
  }
  const updated = await setDecklist(req.session.user.id, text);
  res.json({ decklist: updated.decklist });
});

app.post('/api/team/member-decklist', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const requesterId = req.session.user.id;
  const captainId = await getUserTeamCaptainId(requesterId);
  if (!captainId) {
    return res.status(403).json({ error: 'not_on_a_team' });
  }
  const { memberId, text } = req.body ?? {};
  if (typeof memberId !== 'string' || typeof text !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'too_long' });
  }
  const team = await getTeam(captainId);
  const rosterIds = [team?.captainId, ...(team?.memberIds ?? [])];
  if (!rosterIds.includes(memberId)) {
    return res.status(403).json({ error: 'not_your_teammate' });
  }
  const updated = await setDecklist(memberId, text);
  res.json({ decklist: updated.decklist });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/settings', async (req, res) => {
  const settings = await getSettings();
  const rounds = await getRounds();
  const nextRoundAt = getRoundStartTime(rounds.length + 1).toISOString();
  res.json({
    settings: { ...settings, nextRoundAt, discordBotConfigured: isDiscordBotConfigured(), autoRemindersActive },
  });
});

app.post('/api/settings', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  if (typeof req.body?.signupsOpen !== 'boolean') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const settings = await setSignupsOpen(req.body.signupsOpen);
  let removedCount = 0;
  if (!req.body.signupsOpen) {
    const removed = await removeTeamlessEnrolledUsers();
    removedCount = removed.length;
  }
  res.json({ settings, removedCount });
});

app.post('/api/enroll', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  if (typeof req.body?.enrolled !== 'boolean') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const settings = await getSettings();
  if (!settings.signupsOpen) {
    return res.status(403).json({ error: 'signups_closed' });
  }
  const id = req.session.user.id;
  const updated = await setEnrollment(id, req.body.enrolled);
  if (req.body.enrolled) {
    await addRoleToMember(id);
  } else {
    await disbandTeam(id);
    await removeMemberEverywhere(id);
    await removeRoleFromMember(id);
  }
  res.json({ enrolled: updated.enrolled });
});

app.post('/api/captain', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  if (typeof req.body?.captain !== 'boolean') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const settings = await getSettings();
  if (!settings.signupsOpen) {
    return res.status(403).json({ error: 'signups_closed' });
  }
  const id = req.session.user.id;
  const stored = await getUser(id);
  if (!stored?.enrolled) {
    return res.status(400).json({ error: 'must_be_enrolled' });
  }

  if (req.body.captain) {
    if (await isMemberOfAnyTeam(id)) {
      return res.status(409).json({ error: 'already_a_team_member' });
    }
    const updated = await setCaptain(id, true);
    const team = await ensureTeam(id);
    return res.json({ isCaptain: updated.isCaptain, team: await resolveTeam(team) });
  }

  const updated = await setCaptain(id, false);
  await disbandTeam(id);
  res.json({ isCaptain: updated.isCaptain, team: null });
});

app.post('/api/team/members', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const captainId = req.session.user.id;
  const captain = await getUser(captainId);
  if (!captain?.isCaptain) {
    return res.status(403).json({ error: 'not_a_captain' });
  }
  const settings = await getSettings();
  if (!settings.signupsOpen) {
    return res.status(403).json({ error: 'signups_closed' });
  }

  const { memberId, action } = req.body ?? {};
  if (typeof memberId !== 'string' || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  if (action === 'remove') {
    const team = (await removeMember(captainId, memberId)) ?? (await ensureTeam(captainId));
    return res.json({ team: await resolveTeam(team) });
  }

  if (memberId === captainId) {
    return res.status(400).json({ error: 'cannot_add_self' });
  }
  const candidate = await getUser(memberId);
  if (!candidate?.enrolled) {
    return res.status(404).json({ error: 'candidate_not_enrolled' });
  }
  if (candidate.isCaptain) {
    return res.status(409).json({ error: 'candidate_is_captain' });
  }
  if (await isMemberOfAnyTeam(memberId)) {
    return res.status(409).json({ error: 'candidate_already_on_a_team' });
  }
  const team = await addMember(captainId, memberId);
  if (!team) {
    return res.status(409).json({ error: 'team_already_full' });
  }
  res.json({ team: await resolveTeam(team) });
});

app.post('/api/team/info', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const captainId = req.session.user.id;
  const captain = await getUser(captainId);
  if (!captain?.isCaptain) {
    return res.status(403).json({ error: 'not_a_captain' });
  }

  const { teamName, charity } = req.body ?? {};
  if (typeof teamName !== 'string' || typeof charity !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (teamName.length > 60 || charity.length > 80) {
    return res.status(400).json({ error: 'too_long' });
  }

  const team = await setTeamInfo(captainId, { teamName: teamName.trim(), charity: charity.trim() });
  res.json({ team: await resolveTeam(team) });
});

app.post('/api/team/seats/swap', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const captainId = req.session.user.id;
  const captain = await getUser(captainId);
  if (!captain?.isCaptain) {
    return res.status(403).json({ error: 'not_a_captain' });
  }

  const { seatA, seatB } = req.body ?? {};
  if (!SEATS.includes(seatA) || !SEATS.includes(seatB) || seatA === seatB) {
    return res.status(400).json({ error: 'invalid_seats' });
  }

  // Lock in the open round's matchups (using whatever seats are live right
  // now) before applying the swap, for any pairing that predates seat
  // snapshotting and so is still tracking live seats.
  const allTeams = await getAllTeams();
  const seatsByCaptainId = {};
  for (const t of allTeams) {
    seatsByCaptainId[t.captainId] = t.seats ?? { pioneer: null, modern: null, standard: null };
  }
  await backfillCurrentRoundSeats(seatsByCaptainId);

  const team = await swapSeats(captainId, seatA, seatB);
  if (!team) {
    return res.status(404).json({ error: 'team_not_found' });
  }
  res.json({ team: await resolveTeam(team) });
});

app.get('/api/decklists', async (req, res) => {
  const round = await getCurrentRound();
  const formats = { pioneer: [], modern: [], standard: [] };
  if (!round) {
    return res.json({ round: null, formats });
  }

  for (const p of round.pairings) {
    const teamAInfo = await resolveTeam(await getTeam(p.teamA));
    const teamBInfo = p.teamB ? await resolveTeam(await getTeam(p.teamB)) : null;
    const seatsA = p.seatsSnapshot ? await resolveSeatsSnapshot(p.seatsSnapshot.teamA) : teamAInfo.seats;
    const seatsB = p.seatsSnapshot && teamBInfo ? await resolveSeatsSnapshot(p.seatsSnapshot.teamB) : teamBInfo?.seats;
    const decklistsA = p.decklistsSnapshot?.teamA ?? {};
    const decklistsB = p.decklistsSnapshot?.teamB ?? {};
    const teamAName = teamAInfo.teamName || `${teamAInfo.captainName}'s Team`;
    const teamBName = teamBInfo ? teamBInfo.teamName || `${teamBInfo.captainName}'s Team` : null;

    for (const seat of SEATS) {
      const a = seatsA[seat];
      if (a) {
        formats[seat].push({
          playerId: a.id,
          playerName: a.displayName,
          teamName: teamAName,
          opponentName: seatsB?.[seat]?.displayName ?? null,
          decklist: decklistsA[a.id] || '',
        });
      }
      const b = seatsB?.[seat];
      if (b) {
        formats[seat].push({
          playerId: b.id,
          playerName: b.displayName,
          teamName: teamBName,
          opponentName: seatsA[seat]?.displayName ?? null,
          decklist: decklistsB[b.id] || '',
        });
      }
    }
  }

  res.json({ round: round.number, formats });
});

app.get('/api/pairings', async (req, res) => {
  const rounds = await getRounds();
  const resolved = await Promise.all(
    rounds.map(async (round) => ({
      number: round.number,
      status: round.status,
      pairings: await Promise.all(
        round.pairings.map(async (p) => {
          const teamAInfo = await resolveTeam(await getTeam(p.teamA));
          const teamBInfo = p.teamB ? await resolveTeam(await getTeam(p.teamB)) : null;
          // Pairings generated before seat-snapshotting existed fall back to
          // live seats; every pairing from here on uses the seats as they
          // stood at the moment the round was generated, so a captain
          // swapping seats mid-round doesn't retroactively change matchups
          // already in progress.
          const seatsA = p.seatsSnapshot ? await resolveSeatsSnapshot(p.seatsSnapshot.teamA) : teamAInfo.seats;
          const seatsB = p.seatsSnapshot && teamBInfo ? await resolveSeatsSnapshot(p.seatsSnapshot.teamB) : teamBInfo?.seats;
          const decklistsA = p.decklistsSnapshot?.teamA ?? {};
          const decklistsB = p.decklistsSnapshot?.teamB ?? {};
          const withDecklist = (player, decklists) =>
            player ? { ...player, decklist: decklists[player.id] || '' } : null;
          const matchups = teamBInfo
            ? SEATS.map((seat) => ({
                seat,
                playerA: withDecklist(seatsA[seat], decklistsA),
                playerB: withDecklist(seatsB[seat], decklistsB),
              }))
            : [];
          return {
            id: p.id,
            teamA: { captainId: p.teamA, name: teamAInfo.teamName || `${teamAInfo.captainName}'s Team` },
            teamB: teamBInfo
              ? { captainId: p.teamB, name: teamBInfo.teamName || `${teamBInfo.captainName}'s Team` }
              : null,
            result: p.result,
            matchups,
          };
        })
      ),
    }))
  );
  resolved.sort((a, b) => b.number - a.number);
  res.json({ rounds: resolved });
});

app.post('/api/admin/reset-standings', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  await resetRounds();
  await resetAllRecords();
  res.json({ ok: true });
});

app.post('/api/admin/dummy-accounts', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (req.body.enabled) {
    await seedDummyAccounts();
  } else {
    await clearDummyAccounts();
  }
  const settings = await setDummyAccountsEnabled(req.body.enabled);
  res.json({ settings });
});

app.post('/api/admin/send-decklist-reminder', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  if (!isDiscordBotConfigured()) {
    return res.status(400).json({ error: 'bot_not_configured' });
  }

  const enrolled = await getEnrolledUsers();
  const missing = enrolled.filter((u) => !u.decklist || !u.decklist.trim());
  if (missing.length === 0) {
    return res.json({ sent: false, count: 0 });
  }

  const rounds = await getRounds();
  const nextRoundAt = getRoundStartTime(rounds.length + 1);

  const result = await sendDecklistReminder(
    REMINDER_CHANNEL_ID,
    missing.map((u) => u.id),
    CLIENT_URL,
    nextRoundAt
  );
  if (!result.ok) {
    return res.status(502).json({ error: 'send_failed' });
  }
  res.json({ sent: true, count: missing.length });
});

app.post('/api/admin/send-result-reminder', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  if (!isDiscordBotConfigured()) {
    return res.status(400).json({ error: 'bot_not_configured' });
  }

  const round = await getCurrentRound();
  if (!round) {
    return res.json({ sent: false, matchCount: 0 });
  }

  const { matches, teamCount } = await getUnreportedMatches(round);
  if (matches.length === 0) {
    return res.json({ sent: false, matchCount: 0 });
  }

  const nextRoundAt = getRoundStartTime(round.number + 1);
  const result = await sendResultReminder(REMINDER_CHANNEL_ID, matches, CLIENT_URL, nextRoundAt);
  if (!result.ok) {
    return res.status(502).json({ error: 'send_failed' });
  }
  res.json({ sent: true, matchCount: matches.length, teamCount });
});

app.post('/api/pairings/advance', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }

  const closeResult = await closeCurrentRound();
  if (closeResult.deltas.length > 0) {
    await applyRoundResults(closeResult.deltas);
  }

  const allTeams = await getAllTeams();
  const eligible = allTeams.filter((t) => t.memberIds.length === 2 && (t.losses ?? 0) < ELIMINATION_LOSSES);
  if (eligible.length < 2) {
    return res.status(400).json({ error: 'not_enough_teams', roundClosed: closeResult.closed });
  }

  const allUsers = await getAllUsers();
  const decklistsById = new Map(allUsers.map((u) => [u.id, u.decklist ?? '']));
  const newRound = await generateNextRound(eligible, decklistsById);
  res.json({ round: newRound });
});

app.post('/api/pairings/report', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const { pairingId, outcome } = req.body ?? {};
  if (typeof pairingId !== 'string' || !['win', 'loss'].includes(outcome)) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const myTeamCaptainId = await getUserTeamCaptainId(req.session.user.id);
  if (!myTeamCaptainId) {
    return res.status(403).json({ error: 'not_on_a_team' });
  }

  const round = await reportResult(pairingId, myTeamCaptainId, outcome);
  if (!round) {
    return res.status(400).json({ error: 'invalid_report' });
  }
  res.json({ ok: true });
});

app.get('/api/league', async (req, res) => {
  const [enrolled, allTeams] = await Promise.all([getEnrolledUsers(), getAllTeams()]);
  const memberIds = new Set(allTeams.flatMap((t) => t.memberIds));

  // Whether someone has a decklist on file is only shown to admins -- it's
  // not exposed to the general public alongside the rest of the roster.
  let requesterIsAdmin = false;
  if (req.session.user) {
    const requester = await getUser(req.session.user.id);
    requesterIsAdmin = requester?.isAdmin ?? false;
  }

  const users = enrolled.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    enrolledAt: u.enrolledAt,
    isCaptain: u.isCaptain,
    isAdmin: u.isAdmin ?? false,
    onTeam: u.isCaptain || memberIds.has(u.id),
    ...(requesterIsAdmin ? { hasDecklist: Boolean(u.decklist && u.decklist.trim()) } : {}),
  }));
  res.json({ users });
});

app.post('/api/admin/team-paid', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  const stored = await getUser(req.session.user.id);
  if (!stored?.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }
  const { captainId, paid } = req.body ?? {};
  if (typeof captainId !== 'string' || typeof paid !== 'boolean') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const team = await setPaid(captainId, paid);
  if (!team) return res.status(404).json({ error: 'team_not_found' });
  res.json({ team: { ...(await resolveTeam(team)), paid: team.paid ?? false } });
});

app.get('/api/teams', async (req, res) => {
  const allTeams = await getAllTeams();

  // Whether a team has paid is admin-only, same as decklist-submission
  // status on the roster -- never exposed to the general public.
  let requesterIsAdmin = false;
  if (req.session.user) {
    const requester = await getUser(req.session.user.id);
    requesterIsAdmin = requester?.isAdmin ?? false;
  }

  const tiebreakers = computeTiebreakers(await getRounds());

  const resolved = await Promise.all(
    allTeams.map(async (t) => {
      const r = { ...(await resolveTeam(t)), omw: tiebreakers.get(t.captainId)?.omw ?? null };
      return requesterIsAdmin ? { ...r, paid: t.paid ?? false } : r;
    })
  );
  resolved.sort((a, b) => a.captainName.localeCompare(b.captainName));
  res.json({ teams: resolved });
});

// In production this single service also serves the built React app,
// so there's only one deployable unit and no cross-origin cookie issues.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/auth).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Only the deployed site sends automatic reminders -- a local dev server
// shares the production Redis and Discord bot, and must never ping people.
if (autoRemindersActive) {
  // The site is always on now, so advance rounds from the timer too (not just
  // on visits) and announce the new round right after it's generated.
  setInterval(async () => {
    await maybeAutoAdvance().catch((err) => console.error('Auto-advance check failed:', err));
    await checkNewRoundAnnouncement().catch((err) => console.error('Round announcement failed:', err));
    await checkResultReminders().catch((err) => console.error('Result reminder check failed:', err));
  }, 60 * 1000);
}

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
