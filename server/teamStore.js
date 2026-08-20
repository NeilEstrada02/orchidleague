import { redisClient } from './redis.js';

const KEY = 'orchid:teams';

export const SEATS = ['pioneer', 'modern', 'standard'];

async function loadTeams() {
  const raw = await redisClient.get(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTeams(teams) {
  await redisClient.set(KEY, JSON.stringify(teams));
}

function blankTeam(captainId) {
  return {
    captainId,
    memberIds: [],
    teamName: '',
    charity: '',
    wins: 0,
    losses: 0,
    seats: { pioneer: null, modern: null, standard: null },
    updatedAt: new Date().toISOString(),
  };
}

function ensureSeats(team) {
  if (!team.seats) team.seats = { pioneer: null, modern: null, standard: null };
  return team.seats;
}

// Whenever a team is complete (captain + 2 members), every one of those 3
// people should always occupy exactly one seat. This backfills anyone left
// unseated (a fresh full team, or a member re-added after a swap-out) into
// whichever seats are still open, so the UI never has to handle "no one's
// assigned yet" for a full team.
function applyDefaultSeatsIfNeeded(team) {
  if (team.memberIds.length !== 2) return false;
  const seats = ensureSeats(team);
  const people = [team.captainId, ...team.memberIds];
  const occupied = new Set(SEATS.map((s) => seats[s]).filter(Boolean));
  const unseated = people.filter((p) => !occupied.has(p));
  const emptySeats = SEATS.filter((s) => !seats[s]);
  let changed = false;
  unseated.forEach((personId, i) => {
    if (emptySeats[i]) {
      seats[emptySeats[i]] = personId;
      changed = true;
    }
  });
  return changed;
}

export async function getTeam(captainId) {
  const teams = await loadTeams();
  const team = teams[captainId] ?? null;
  if (team && applyDefaultSeatsIfNeeded(team)) {
    teams[captainId] = team;
    await saveTeams(teams);
  }
  return team;
}

export async function getAllTeams() {
  const teams = await loadTeams();
  let changed = false;
  for (const team of Object.values(teams)) {
    if (applyDefaultSeatsIfNeeded(team)) changed = true;
  }
  if (changed) await saveTeams(teams);
  return Object.values(teams);
}

export async function isMemberOfAnyTeam(userId) {
  const teams = await loadTeams();
  return Object.values(teams).some((t) => t.memberIds.includes(userId));
}

export async function ensureTeam(captainId) {
  const teams = await loadTeams();
  if (!teams[captainId]) {
    teams[captainId] = blankTeam(captainId);
    await saveTeams(teams);
  }
  return teams[captainId];
}

export async function setTeamInfo(captainId, { teamName, charity }) {
  const teams = await loadTeams();
  const team = teams[captainId] ?? blankTeam(captainId);
  team.teamName = teamName;
  team.charity = charity;
  team.updatedAt = new Date().toISOString();
  teams[captainId] = team;
  await saveTeams(teams);
  return team;
}

export async function addMember(captainId, memberId) {
  const teams = await loadTeams();
  const team = teams[captainId] ?? blankTeam(captainId);
  if (!team.memberIds.includes(memberId)) {
    if (team.memberIds.length >= 2) return null;
    team.memberIds.push(memberId);
    team.updatedAt = new Date().toISOString();
  }
  applyDefaultSeatsIfNeeded(team);
  teams[captainId] = team;
  await saveTeams(teams);
  return team;
}

export async function removeMember(captainId, memberId) {
  const teams = await loadTeams();
  const team = teams[captainId];
  if (!team) return null;
  team.memberIds = team.memberIds.filter((id) => id !== memberId);
  const seats = ensureSeats(team);
  for (const seat of SEATS) {
    if (seats[seat] === memberId) seats[seat] = null;
  }
  team.updatedAt = new Date().toISOString();
  await saveTeams(teams);
  return team;
}

export async function swapSeats(captainId, seatA, seatB) {
  const teams = await loadTeams();
  const team = teams[captainId];
  if (!team) return null;
  const seats = ensureSeats(team);
  const temp = seats[seatA];
  seats[seatA] = seats[seatB];
  seats[seatB] = temp;
  team.updatedAt = new Date().toISOString();
  await saveTeams(teams);
  return team;
}

export async function disbandTeam(captainId) {
  const teams = await loadTeams();
  if (teams[captainId]) {
    delete teams[captainId];
    await saveTeams(teams);
  }
}

export async function removeMemberEverywhere(memberId) {
  const teams = await loadTeams();
  let anyChanged = false;
  for (const team of Object.values(teams)) {
    let teamChanged = false;
    if (team.memberIds.includes(memberId)) {
      team.memberIds = team.memberIds.filter((id) => id !== memberId);
      teamChanged = true;
    }
    const seats = ensureSeats(team);
    for (const seat of SEATS) {
      if (seats[seat] === memberId) {
        seats[seat] = null;
        teamChanged = true;
      }
    }
    if (teamChanged) {
      team.updatedAt = new Date().toISOString();
      anyChanged = true;
    }
  }
  if (anyChanged) await saveTeams(teams);
}

// deltas: [{ captainId, outcome: 'win' | 'loss' }]
export async function applyRoundResults(deltas) {
  if (deltas.length === 0) return;
  const teams = await loadTeams();
  for (const { captainId, outcome } of deltas) {
    const team = teams[captainId];
    if (!team) continue;
    if (outcome === 'win') {
      team.wins = (team.wins ?? 0) + 1;
    } else {
      team.losses = (team.losses ?? 0) + 1;
    }
  }
  await saveTeams(teams);
}

export async function resetAllRecords() {
  const teams = await loadTeams();
  for (const team of Object.values(teams)) {
    team.wins = 0;
    team.losses = 0;
  }
  await saveTeams(teams);
}
