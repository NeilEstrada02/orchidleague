import { redisClient } from './redis.js';

const KEY = 'orchid:teams';

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
    updatedAt: new Date().toISOString(),
  };
}

export async function getTeam(captainId) {
  const teams = await loadTeams();
  return teams[captainId] ?? null;
}

export async function getAllTeams() {
  return Object.values(await loadTeams());
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
  teams[captainId] = team;
  await saveTeams(teams);
  return team;
}

export async function removeMember(captainId, memberId) {
  const teams = await loadTeams();
  const team = teams[captainId];
  if (!team) return null;
  team.memberIds = team.memberIds.filter((id) => id !== memberId);
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
  let changed = false;
  for (const team of Object.values(teams)) {
    if (team.memberIds.includes(memberId)) {
      team.memberIds = team.memberIds.filter((id) => id !== memberId);
      team.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await saveTeams(teams);
}
