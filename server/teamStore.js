import { cachedGet, freshGet, cachedSet } from './cache.js';

const KEY = 'orchid:teams';

export const SEATS = ['pioneer', 'modern', 'standard'];

// Readers use the short-lived cache; anything that modifies teams reads fresh.
async function loadTeams(fresh = false) {
  const raw = fresh ? await freshGet(KEY) : await cachedGet(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTeams(teams) {
  await cachedSet(KEY, JSON.stringify(teams));
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
    paid: false,
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

// Reading a team can also repair its seats; that write only happens (from a
// fresh copy) when the cached copy actually needs it.
export async function getTeam(captainId) {
  let teams = await loadTeams();
  let team = teams[captainId] ?? null;
  if (team && applyDefaultSeatsIfNeeded(structuredClone(team))) {
    teams = await loadTeams(true);
    team = teams[captainId] ?? null;
    if (team && applyDefaultSeatsIfNeeded(team)) await saveTeams(teams);
  }
  return team;
}

export async function getAllTeams() {
  let teams = await loadTeams();
  if (Object.values(teams).some((team) => applyDefaultSeatsIfNeeded(structuredClone(team)))) {
    teams = await loadTeams(true);
    let changed = false;
    for (const team of Object.values(teams)) {
      if (applyDefaultSeatsIfNeeded(team)) changed = true;
    }
    if (changed) await saveTeams(teams);
  }
  return Object.values(teams);
}

export async function isMemberOfAnyTeam(userId) {
  const teams = await loadTeams();
  return Object.values(teams).some((t) => t.memberIds.includes(userId));
}

export async function ensureTeam(captainId) {
  const teams = await loadTeams(true);
  if (!teams[captainId]) {
    teams[captainId] = blankTeam(captainId);
    await saveTeams(teams);
  }
  return teams[captainId];
}

export async function setTeamInfo(captainId, { teamName, charity }) {
  const teams = await loadTeams(true);
  const team = teams[captainId] ?? blankTeam(captainId);
  team.teamName = teamName;
  team.charity = charity;
  team.updatedAt = new Date().toISOString();
  teams[captainId] = team;
  await saveTeams(teams);
  return team;
}

export async function addMember(captainId, memberId) {
  const teams = await loadTeams(true);
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
  const teams = await loadTeams(true);
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

export async function setPaid(captainId, paid) {
  const teams = await loadTeams(true);
  const team = teams[captainId];
  if (!team) return null;
  team.paid = paid;
  team.updatedAt = new Date().toISOString();
  await saveTeams(teams);
  return team;
}

export async function swapSeats(captainId, seatA, seatB) {
  const teams = await loadTeams(true);
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
  const teams = await loadTeams(true);
  if (teams[captainId]) {
    delete teams[captainId];
    await saveTeams(teams);
  }
}

export async function removeMemberEverywhere(memberId) {
  const teams = await loadTeams(true);
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
  const teams = await loadTeams(true);
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
  const teams = await loadTeams(true);
  for (const team of Object.values(teams)) {
    team.wins = 0;
    team.losses = 0;
  }
  await saveTeams(teams);
}

// records: Map<captainId, { wins, losses }>. Sets every team's record to the
// given values (0-0 for teams not in the map).
export async function setAllRecords(records) {
  const teams = await loadTeams(true);
  for (const team of Object.values(teams)) {
    const record = records.get(team.captainId);
    team.wins = record?.wins ?? 0;
    team.losses = record?.losses ?? 0;
  }
  await saveTeams(teams);
}
