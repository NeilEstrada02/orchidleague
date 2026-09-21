import { redisClient } from './redis.js';

const KEY = 'orchid:rounds';
const BLANK_SEATS = { pioneer: null, modern: null, standard: null };

async function loadRounds() {
  const raw = await redisClient.get(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRounds(rounds) {
  await redisClient.set(KEY, JSON.stringify(rounds));
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const isPlayoff = (round) => round.stage === 'playoff';

function buildRematchSet(rounds) {
  const set = new Set();
  for (const round of rounds) {
    if (isPlayoff(round)) continue;
    for (const p of round.pairings) {
      if (p.teamB) set.add(pairKey(p.teamA, p.teamB));
    }
  }
  return set;
}

function buildByeHistory(rounds) {
  const set = new Set();
  for (const round of rounds) {
    if (isPlayoff(round)) continue;
    for (const p of round.pairings) {
      if (!p.teamB) set.add(p.teamA);
    }
  }
  return set;
}

// Randomized search for a zero-rematch pairing of an even-length group.
// Falls back to the attempt with the fewest rematches if none is found clean.
function pairGroupNoRematch(teamIds, rematchSet, attempts = 300) {
  if (teamIds.length === 0) return [];
  let best = null;
  let bestRematches = Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const shuffled = shuffle(teamIds);
    const pairs = [];
    let rematches = 0;
    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i];
      const b = shuffled[i + 1];
      pairs.push([a, b]);
      if (rematchSet.has(pairKey(a, b))) rematches++;
    }
    if (rematches === 0) return pairs;
    if (rematches < bestRematches) {
      bestRematches = rematches;
      best = pairs;
    }
  }
  return best;
}

export async function getRounds() {
  return loadRounds();
}

// Standard Magic floor: an opponent never counts for less than 33% when
// averaging opponents' match-win percentages.
const MIN_MATCH_WIN_PCT = 1 / 3;

// Wins and losses already decided in the round that's still in progress --
// matches with a reported result, plus the bye win -- that haven't been
// applied to team records yet (that only happens when the round closes).
// Unreported matches aren't counted; they only become losses at close.
// Returns Map<captainId, { wins, losses }>.
export function computeProvisionalRecords(rounds) {
  const result = new Map();
  const add = (id, key) => {
    if (!result.has(id)) result.set(id, { wins: 0, losses: 0 });
    result.get(id)[key]++;
  };
  const open = rounds.find((r) => r.status === 'open' && !isPlayoff(r));
  for (const p of open?.pairings ?? []) {
    if (!p.teamB) add(p.teamA, 'wins');
    else if (p.result === 'A') { add(p.teamA, 'wins'); add(p.teamB, 'losses'); }
    else if (p.result === 'B') { add(p.teamB, 'wins'); add(p.teamA, 'losses'); }
  }
  return result;
}

// Opponents' match-win percentage (OMW%) per team, from closed rounds plus
// any matches already reported in the round in progress. Byes are ignored
// both as an opponent and in a team's own match-win percentage, per the Magic
// tournament rules. Returns Map<captainId, { omw }>; teams with no opponents
// yet are absent.
export function computeTiebreakers(rounds) {
  const records = new Map();
  const opponents = new Map();
  const record = (id) => {
    if (!records.has(id)) records.set(id, { wins: 0, matches: 0 });
    return records.get(id);
  };

  for (const round of rounds) {
    if (isPlayoff(round)) continue;
    for (const p of round.pairings) {
      if (!p.teamB) continue;
      // In the open round only reported matches have happened so far.
      if (round.status !== 'closed' && !p.result) continue;
      const a = record(p.teamA);
      const b = record(p.teamB);
      a.matches++;
      b.matches++;
      if (p.result === 'A') a.wins++;
      else if (p.result === 'B') b.wins++;
      if (!opponents.has(p.teamA)) opponents.set(p.teamA, []);
      if (!opponents.has(p.teamB)) opponents.set(p.teamB, []);
      opponents.get(p.teamA).push(p.teamB);
      opponents.get(p.teamB).push(p.teamA);
    }
  }

  const matchWinPct = (id) => {
    const r = records.get(id);
    if (!r || r.matches === 0) return MIN_MATCH_WIN_PCT;
    return Math.max(MIN_MATCH_WIN_PCT, r.wins / r.matches);
  };

  const result = new Map();
  for (const [id, opps] of opponents) {
    const omw = opps.reduce((sum, oppId) => sum + matchWinPct(oppId), 0) / opps.length;
    result.set(id, { omw });
  }
  return result;
}

export async function resetRounds() {
  await saveRounds([]);
}

// Locks in the current lineup for any pairing in the open round that
// predates seat-snapshotting (or was otherwise never snapshotted), using
// whatever seats are live right now. Called just before a seat swap is
// applied, so the round's matchups freeze at "how things stood right before
// this swap" instead of continuing to track live seats indefinitely.
export async function backfillCurrentRoundSeats(seatsByCaptainId) {
  const rounds = await loadRounds();
  const round = rounds[rounds.length - 1];
  if (!round || round.status !== 'open') return false;
  let changed = false;
  for (const p of round.pairings) {
    if (!p.seatsSnapshot) {
      p.seatsSnapshot = {
        teamA: seatsByCaptainId[p.teamA] ?? BLANK_SEATS,
        teamB: p.teamB ? seatsByCaptainId[p.teamB] ?? BLANK_SEATS : null,
      };
      changed = true;
    }
  }
  if (changed) await saveRounds(rounds);
  return changed;
}

export async function getCurrentRound() {
  const rounds = await loadRounds();
  const last = rounds[rounds.length - 1];
  return last && last.status === 'open' ? last : null;
}

// Finalizes the currently open round: any pairing with no reported result
// (and that isn't a bye) is scored as a loss for BOTH teams. Returns the
// win/loss deltas to apply to team records, and whether a round was closed.
// In a playoff round nothing counts toward Swiss records, and a match nobody
// reported goes to the higher seed (a bracket can't have two losers).
export async function closeCurrentRound() {
  const rounds = await loadRounds();
  const round = rounds[rounds.length - 1];
  if (!round || round.status !== 'open') return { deltas: [], closed: false };

  if (isPlayoff(round)) {
    for (const p of round.pairings) {
      if (!p.result) {
        p.result = p.seedA <= p.seedB ? 'A' : 'B';
        p.autoResolved = true;
      }
    }
    round.status = 'closed';
    round.closedAt = new Date().toISOString();
    await saveRounds(rounds);
    return { deltas: [], closed: true };
  }

  const deltas = [];
  for (const p of round.pairings) {
    if (!p.teamB) {
      deltas.push({ captainId: p.teamA, outcome: 'win' });
      continue;
    }
    if (!p.result) {
      p.result = 'double-loss';
    }
    if (p.result === 'A') {
      deltas.push({ captainId: p.teamA, outcome: 'win' });
      deltas.push({ captainId: p.teamB, outcome: 'loss' });
    } else if (p.result === 'B') {
      deltas.push({ captainId: p.teamB, outcome: 'win' });
      deltas.push({ captainId: p.teamA, outcome: 'loss' });
    } else {
      deltas.push({ captainId: p.teamA, outcome: 'loss' });
      deltas.push({ captainId: p.teamB, outcome: 'loss' });
    }
  }
  round.status = 'closed';
  round.closedAt = new Date().toISOString();
  await saveRounds(rounds);
  return { deltas, closed: true };
}

function snapshotDecklists(team, decklistsById) {
  const people = [team.captainId, ...team.memberIds];
  const result = {};
  for (const id of people) result[id] = decklistsById.get(id) ?? '';
  return result;
}

// eligibleTeams: [{ captainId, wins, seats, memberIds }]
// decklistsById: Map<userId, string>
export async function generateNextRound(eligibleTeams, decklistsById = new Map()) {
  const rounds = await loadRounds();
  const rematchSet = buildRematchSet(rounds);
  const byeHistory = buildByeHistory(rounds);
  const roundNumber = rounds.length + 1;

  // Snapshot each team's current seat assignments AND each player's current
  // decklist at generation time, so later seat swaps or decklist edits only
  // affect rounds generated after the change -- this round stays exactly as
  // it was when it was created.
  const seatsById = new Map(eligibleTeams.map((t) => [t.captainId, t.seats ?? BLANK_SEATS]));
  const teamsById = new Map(eligibleTeams.map((t) => [t.captainId, t]));
  const winsById = new Map(eligibleTeams.map((t) => [t.captainId, t.wins ?? 0]));
  let pool = shuffle(eligibleTeams.map((t) => t.captainId));
  pool.sort((a, b) => winsById.get(b) - winsById.get(a));

  let byeTeam = null;
  if (pool.length % 2 === 1) {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!byeHistory.has(pool[i])) {
        byeTeam = pool[i];
        break;
      }
    }
    if (!byeTeam) byeTeam = pool[pool.length - 1];
    pool = pool.filter((id) => id !== byeTeam);
  }

  const groups = [];
  let i = 0;
  while (i < pool.length) {
    const w = winsById.get(pool[i]);
    const group = [];
    while (i < pool.length && winsById.get(pool[i]) === w) {
      group.push(pool[i]);
      i++;
    }
    groups.push(group);
  }

  const pairings = [];
  let carryDown = [];
  for (const group of groups) {
    const current = [...carryDown, ...group];
    carryDown = [];
    if (current.length % 2 === 1) {
      carryDown = [current.pop()];
    }
    const pairs = pairGroupNoRematch(current, rematchSet) ?? [];
    for (const [a, b] of pairs) {
      pairings.push({
        teamA: a,
        teamB: b,
        result: null,
        reportedBy: null,
        seatsSnapshot: { teamA: seatsById.get(a), teamB: seatsById.get(b) },
        decklistsSnapshot: {
          teamA: snapshotDecklists(teamsById.get(a), decklistsById),
          teamB: snapshotDecklists(teamsById.get(b), decklistsById),
        },
      });
      rematchSet.add(pairKey(a, b));
    }
  }

  if (byeTeam) {
    pairings.push({
      teamA: byeTeam,
      teamB: null,
      result: 'A',
      reportedBy: null,
      seatsSnapshot: { teamA: seatsById.get(byeTeam), teamB: null },
      decklistsSnapshot: { teamA: snapshotDecklists(teamsById.get(byeTeam), decklistsById), teamB: null },
    });
  }

  const withIds = pairings.map((p, idx) => ({ id: `r${roundNumber}-${idx + 1}`, ...p }));
  const newRound = {
    number: roundNumber,
    status: 'open',
    pairings: withIds,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
  rounds.push(newRound);
  await saveRounds(rounds);
  return newRound;
}

export async function reportResult(pairingId, teamCaptainId, outcome) {
  const rounds = await loadRounds();
  const round = rounds[rounds.length - 1];
  if (!round || round.status !== 'open') return null;
  const pairing = round.pairings.find((p) => p.id === pairingId);
  if (!pairing || !pairing.teamB) return null;
  if (pairing.result) return null;
  if (pairing.teamA !== teamCaptainId && pairing.teamB !== teamCaptainId) return null;

  const won = outcome === 'win';
  const isTeamA = pairing.teamA === teamCaptainId;
  pairing.result = isTeamA === won ? 'A' : 'B';
  pairing.reportedBy = teamCaptainId;
  await saveRounds(rounds);
  return round;
}

// matches: [{ a, b, seedA, seedB }] where a/b are teams ({ captainId, memberIds,
// seats }), team A being the higher seed. Snapshots seats and decklists just
// like a Swiss round, so playoff matchups stay fixed once posted.
export async function generatePlayoffRound(matches, label, decklistsById = new Map()) {
  const rounds = await loadRounds();
  const roundNumber = rounds.length + 1;
  const pairings = matches.map((m, idx) => ({
    id: `r${roundNumber}-${idx + 1}`,
    teamA: m.a.captainId,
    teamB: m.b.captainId,
    seedA: m.seedA,
    seedB: m.seedB,
    result: null,
    reportedBy: null,
    seatsSnapshot: { teamA: m.a.seats ?? BLANK_SEATS, teamB: m.b.seats ?? BLANK_SEATS },
    decklistsSnapshot: {
      teamA: snapshotDecklists(m.a, decklistsById),
      teamB: snapshotDecklists(m.b, decklistsById),
    },
  }));
  const round = {
    number: roundNumber,
    status: 'open',
    stage: 'playoff',
    label,
    pairings,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
  rounds.push(round);
  await saveRounds(rounds);
  return round;
}

// Wins and losses per team that closed Swiss rounds add up to -- what the
// stored team records should always equal. Used to rebuild records after an
// admin corrects a result in a round that's already closed.
export function computeClosedRecords(rounds) {
  const result = new Map();
  const add = (id, key) => {
    if (!result.has(id)) result.set(id, { wins: 0, losses: 0 });
    result.get(id)[key]++;
  };
  for (const round of rounds) {
    if (round.status !== 'closed' || isPlayoff(round)) continue;
    for (const p of round.pairings) {
      if (!p.teamB) add(p.teamA, 'wins');
      else if (p.result === 'A') { add(p.teamA, 'wins'); add(p.teamB, 'losses'); }
      else if (p.result === 'B') { add(p.teamB, 'wins'); add(p.teamA, 'losses'); }
      else { add(p.teamA, 'losses'); add(p.teamB, 'losses'); }
    }
  }
  return result;
}

// ---------- Admin corrections ----------
// Each returns { error } for a bad request, or the details of what changed.

function findPairing(rounds, roundNumber, pairingId) {
  const round = rounds.find((r) => r.number === roundNumber);
  if (!round) return { error: 'round_not_found' };
  const pairing = round.pairings.find((p) => p.id === pairingId);
  if (!pairing) return { error: 'pairing_not_found' };
  return { round, pairing };
}

// result: 'A' | 'B' | 'double-loss' | null. A round still in progress can be
// set back to "pending"; a closed round always has a result. Playoff results
// can only be changed while their round is open, since the next round is built
// from them.
export async function setPairingResult(roundNumber, pairingId, result) {
  const rounds = await loadRounds();
  const found = findPairing(rounds, roundNumber, pairingId);
  if (found.error) return found;
  const { round, pairing } = found;
  if (!pairing.teamB) return { error: 'bye_has_no_result' };

  const open = round.status === 'open';
  if (!open && isPlayoff(round)) return { error: 'playoff_round_closed' };
  const allowed = open ? [null, 'A', 'B'] : ['A', 'B', 'double-loss'];
  if (!allowed.includes(result)) return { error: 'invalid_result' };

  const before = pairing.result;
  pairing.result = result;
  pairing.reportedBy = result ? 'admin' : null;
  delete pairing.autoResolved;
  await saveRounds(rounds);
  return { before, after: result, roundClosed: !open, stage: round.stage ?? 'swiss' };
}

// Swaps two players' formats within one team's lineup for a round. Decklists
// are stored per player, so they follow the player automatically.
export async function swapSnapshotSeats(roundNumber, pairingId, side, seatA, seatB) {
  const rounds = await loadRounds();
  const found = findPairing(rounds, roundNumber, pairingId);
  if (found.error) return found;
  const lineup = found.pairing.seatsSnapshot?.[side === 'B' ? 'teamB' : 'teamA'];
  if (!lineup) return { error: 'no_lineup' };
  if (!(seatA in BLANK_SEATS) || !(seatB in BLANK_SEATS) || seatA === seatB) return { error: 'invalid_seats' };

  const before = { ...lineup };
  [lineup[seatA], lineup[seatB]] = [lineup[seatB], lineup[seatA]];
  await saveRounds(rounds);
  return { before, after: { ...lineup } };
}

// Replaces the decklist locked in for one player in one round.
export async function setSnapshotDecklist(roundNumber, pairingId, playerId, text) {
  const rounds = await loadRounds();
  const found = findPairing(rounds, roundNumber, pairingId);
  if (found.error) return found;
  const side = ['teamA', 'teamB'].find((s) => found.pairing.decklistsSnapshot?.[s] && playerId in found.pairing.decklistsSnapshot[s]);
  if (!side) return { error: 'player_not_in_pairing' };

  const before = found.pairing.decklistsSnapshot[side][playerId];
  found.pairing.decklistsSnapshot[side][playerId] = text;
  await saveRounds(rounds);
  return { beforeLength: before.length, afterLength: text.length };
}

// Removes the newest round if it's still open (e.g. started by mistake). Team
// records are untouched because an open round hasn't been applied to them.
export async function undoOpenRound() {
  const rounds = await loadRounds();
  const last = rounds[rounds.length - 1];
  if (!last) return { error: 'no_rounds' };
  if (last.status !== 'open') return { error: 'round_already_closed' };
  rounds.pop();
  await saveRounds(rounds);
  return { removed: last.number, stage: last.stage ?? 'swiss', pairings: last.pairings.length };
}
