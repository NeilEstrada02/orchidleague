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

function buildRematchSet(rounds) {
  const set = new Set();
  for (const round of rounds) {
    for (const p of round.pairings) {
      if (p.teamB) set.add(pairKey(p.teamA, p.teamB));
    }
  }
  return set;
}

function buildByeHistory(rounds) {
  const set = new Set();
  for (const round of rounds) {
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
export async function closeCurrentRound() {
  const rounds = await loadRounds();
  const round = rounds[rounds.length - 1];
  if (!round || round.status !== 'open') return { deltas: [], closed: false };

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
