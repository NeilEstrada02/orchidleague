import { getAllTeams, applyRoundResults, resetAllRecords, setAllRecords } from './teamStore.js';
import { getAllUsers } from './userStore.js';
import {
  getRounds,
  closeCurrentRound,
  generateNextRound,
  generatePlayoffRound,
  resetRounds,
  computeTiebreakers,
  computeProvisionalRecords,
  computeClosedRecords,
} from './pairingStore.js';
import { getBracket, saveBracket, clearBracket, seedOrder, roundLabel, winnerOf, CUT_SIZES } from './bracketStore.js';
import { getSettings, setPlannedCutSize, setSeasonNumber, setFirstRound } from './settingsStore.js';
import { createBackup } from './backupStore.js';
import { saveArchive, upsertHallOfFame } from './seasonStore.js';

export const ELIMINATION_LOSSES = 3;

class FlowError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const decklistMap = (users) => new Map(users.map((u) => [u.id, u.decklist ?? '']));
const teamDisplay = (team, nameOf) => team.teamName || `${nameOf(team.captainId)}'s Team`;

// Standings order: wins, then fewest losses, then OMW%, then name.
export function rankTeams(teams, tiebreakers, nameOf) {
  const omw = (t) => tiebreakers.get(t.captainId)?.omw ?? -1;
  return [...teams].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      omw(b) - omw(a) ||
      nameOf(a.captainId).localeCompare(nameOf(b.captainId))
  );
}

// Every team with its record as standings show it: closed rounds plus results
// already reported in a Swiss round still in progress.
async function liveStandings() {
  const [teams, users, rounds] = await Promise.all([getAllTeams(), getAllUsers(), getRounds()]);
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  const nameOf = (id) => names.get(id) ?? 'Unknown';
  const provisional = computeProvisionalRecords(rounds);
  const tiebreakers = computeTiebreakers(rounds);
  const withRecords = teams.map((t) => {
    const live = provisional.get(t.captainId);
    return { ...t, wins: (t.wins ?? 0) + (live?.wins ?? 0), losses: (t.losses ?? 0) + (live?.losses ?? 0) };
  });
  return { ranked: rankTeams(withRecords, tiebreakers, nameOf), tiebreakers, nameOf, users, rounds, teams };
}

// ---------- Top cut ----------

export async function startBracket(size) {
  if (!CUT_SIZES.includes(size)) throw new FlowError('invalid_size');
  const [{ ranked, nameOf, users }, teams] = [await liveStandings(), await getAllTeams()];
  const fullTeams = new Map(teams.filter((t) => t.memberIds.length === 2).map((t) => [t.captainId, t]));
  const qualified = ranked.filter((t) => fullTeams.has(t.captainId)).slice(0, size);
  if (qualified.length < size) throw new FlowError('not_enough_teams');

  const seeds = qualified.map((t, i) => ({ seed: i + 1, captainId: t.captainId }));
  const teamBySeed = new Map(seeds.map((s) => [s.seed, fullTeams.get(s.captainId)]));
  const order = seedOrder(size);
  const matches = [];
  for (let i = 0; i < order.length; i += 2) {
    matches.push({ a: teamBySeed.get(order[i]), b: teamBySeed.get(order[i + 1]), seedA: order[i], seedB: order[i + 1] });
  }

  await saveBracket({ size, startedAt: new Date().toISOString(), seeds, championId: null, completedAt: null });
  const round = await generatePlayoffRound(matches, roundLabel(size), decklistMap(users));
  await setPlannedCutSize(null);
  return round;
}

// Builds the next playoff round from the winners of the last one, or names the
// champion after the final.
async function progressBracket(bracket) {
  const [rounds, teams, users] = await Promise.all([getRounds(), getAllTeams(), getAllUsers()]);
  const last = rounds[rounds.length - 1];
  if (!last || last.stage !== 'playoff' || last.status !== 'closed') return { advanced: false, reason: 'no_finished_playoff_round' };

  const winners = last.pairings.map(winnerOf);
  if (winners.length === 1) {
    bracket.championId = winners[0];
    bracket.completedAt = new Date().toISOString();
    await saveBracket(bracket);
    return { advanced: false, reason: 'season_complete' };
  }

  const seedOf = new Map(bracket.seeds.map((s) => [s.captainId, s.seed]));
  const teamById = new Map(teams.map((t) => [t.captainId, t]));
  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    const [a, b] = [winners[i], winners[i + 1]].sort((x, y) => seedOf.get(x) - seedOf.get(y));
    matches.push({ a: teamById.get(a), b: teamById.get(b), seedA: seedOf.get(a), seedB: seedOf.get(b) });
  }
  const round = await generatePlayoffRound(matches, roundLabel(winners.length), decklistMap(users));
  return { advanced: true, round };
}

// ---------- Advancing rounds ----------

// Closes the round in progress (applying its results) and starts whatever
// comes next: the next Swiss round, the top cut if one is scheduled, or the
// next playoff round. Used by the automatic schedule and the admin button.
export async function advanceRound() {
  const closeResult = await closeCurrentRound();
  if (closeResult.deltas.length > 0) await applyRoundResults(closeResult.deltas);
  const roundClosed = closeResult.closed;

  const bracket = await getBracket();
  if (bracket?.championId) return { advanced: false, reason: 'season_complete', roundClosed };
  if (bracket) return { ...(await progressBracket(bracket)), roundClosed };

  const settings = await getSettings();
  if (settings.plannedCutSize) {
    try {
      return { advanced: true, round: await startBracket(settings.plannedCutSize), roundClosed };
    } catch (err) {
      return { advanced: false, reason: err.code ?? 'cut_failed', roundClosed };
    }
  }

  const [teams, users] = await Promise.all([getAllTeams(), getAllUsers()]);
  const eligible = teams.filter((t) => t.memberIds.length === 2 && (t.losses ?? 0) < ELIMINATION_LOSSES);
  if (eligible.length < 2) return { advanced: false, reason: 'not_enough_teams', roundClosed };
  return { advanced: true, round: await generateNextRound(eligible, decklistMap(users)), roundClosed };
}

// ---------- Corrections & season lifecycle ----------

// Rebuilds every team's win/loss record from closed rounds. Run after an admin
// changes a result in a round that has already been applied.
export async function recomputeTeamRecords() {
  await setAllRecords(computeClosedRecords(await getRounds()));
}

// Clears rounds, records and the bracket. The round schedule is cleared too:
// left in place, its long-past first-round date would make the automatic
// advance generate every "missed" round of the new season in one go.
export async function resetSeasonData() {
  await resetRounds();
  await resetAllRecords();
  await clearBracket();
  await setPlannedCutSize(null);
  await setFirstRound(null);
}

// Archives the season in full, adds its champion to the Hall of Fame, then
// starts a fresh season. `champion`: 'bracket' (the top cut winner), a team's
// captain id, or null for none.
export async function endSeason(champion) {
  await createBackup('pre-end-season');
  const [standing, bracket, settings] = await Promise.all([liveStandings(), getBracket(), getSettings()]);
  const { ranked, tiebreakers, nameOf, users, rounds } = standing;
  const teamsById = new Map(ranked.map((t) => [t.captainId, t]));

  const memberNames = (team) => [team.captainId, ...team.memberIds].map(nameOf);
  const championId = champion === 'bracket' ? bracket?.championId ?? null : champion;
  const championTeam = championId ? teamsById.get(championId) : null;

  const archivedAt = new Date().toISOString();
  const archive = {
    season: settings.seasonNumber,
    archivedAt,
    champion: championTeam
      ? { captainId: championId, name: teamDisplay(championTeam, nameOf), members: memberNames(championTeam) }
      : null,
    standings: ranked.map((t, i) => ({
      rank: i + 1,
      captainId: t.captainId,
      name: teamDisplay(t, nameOf),
      members: memberNames(t),
      wins: t.wins,
      losses: t.losses,
      omw: tiebreakers.get(t.captainId)?.omw ?? null,
    })),
    bracket,
    rounds,
    players: Object.fromEntries(users.map((u) => [u.id, u.displayName])),
  };
  await saveArchive(archive);

  if (archive.champion) {
    await upsertHallOfFame({
      season: settings.seasonNumber,
      champion: archive.champion.name,
      members: archive.champion.members,
    });
  }

  await resetSeasonData();
  await setSeasonNumber(settings.seasonNumber + 1);
  return { season: settings.seasonNumber, champion: archive.champion, nextSeason: settings.seasonNumber + 1 };
}
