import express from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { redisClient } from './redis.js';
import { recordLogin, getUser, setEnrollment, getEnrolledUsers, setCaptain } from './userStore.js';
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
  SEATS,
  applyRoundResults,
  resetAllRecords,
} from './teamStore.js';
import { getSettings, setSignupsOpen } from './settingsStore.js';
import { getRounds, closeCurrentRound, generateNextRound, reportResult, resetRounds } from './pairingStore.js';

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

async function getUserTeamCaptainId(userId) {
  const stored = await getUser(userId);
  if (stored?.isCaptain) return userId;
  const allTeams = await getAllTeams();
  const team = allTeams.find((t) => t.memberIds.includes(userId));
  return team?.captainId ?? null;
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
  const team = stored?.isCaptain ? await resolveTeam(await getTeam(req.session.user.id)) : null;
  const myTeamCaptainId = await getUserTeamCaptainId(req.session.user.id);
  res.json({
    user: {
      ...req.session.user,
      enrolled: stored?.enrolled ?? false,
      isCaptain: stored?.isCaptain ?? false,
      isAdmin: stored?.isAdmin ?? false,
      team,
      myTeamCaptainId,
    },
  });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/settings', async (req, res) => {
  const settings = await getSettings();
  res.json({ settings });
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
  res.json({ settings });
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
  if (!req.body.enrolled) {
    await disbandTeam(id);
    await removeMemberEverywhere(id);
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
  const settings = await getSettings();
  if (!settings.signupsOpen) {
    return res.status(403).json({ error: 'signups_closed' });
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

  const team = await swapSeats(captainId, seatA, seatB);
  if (!team) {
    return res.status(404).json({ error: 'team_not_found' });
  }
  res.json({ team: await resolveTeam(team) });
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
          const matchups = teamBInfo
            ? SEATS.map((seat) => ({
                seat,
                playerA: teamAInfo.seats[seat],
                playerB: teamBInfo.seats[seat],
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

  const newRound = await generateNextRound(eligible);
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
  const users = enrolled.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    enrolledAt: u.enrolledAt,
    isCaptain: u.isCaptain,
    isAdmin: u.isAdmin ?? false,
    onTeam: u.isCaptain || memberIds.has(u.id),
  }));
  res.json({ users });
});

app.get('/api/teams', async (req, res) => {
  const allTeams = await getAllTeams();
  const resolved = await Promise.all(allTeams.map(resolveTeam));
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

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
