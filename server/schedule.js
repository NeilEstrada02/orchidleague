const TIME_ZONE = 'America/New_York';

// The season this site launched with: Round 1 on Sunday, August 30, 2026 at
// 11:59pm Eastern. Later seasons set their own first-round date in settings.
export const DEFAULT_FIRST_ROUND = { year: 2026, month: 8, day: 30, hour: 23, minute: 59 };

// firstRound: { year, month, day, hour, minute } in Eastern wall-clock time.
export function isValidFirstRound(fr) {
  const ok = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  return Boolean(fr) && ok(fr.year, 2024, 2100) && ok(fr.month, 1, 12) && ok(fr.day, 1, 31) && ok(fr.hour, 0, 23) && ok(fr.minute, 0, 59);
}

// Converts a wall-clock date/time in `timeZone` to the correct UTC instant,
// accounting for whatever DST offset applies on that specific date.
function zonedTimeToUtc(y, m, d, hh, mm, timeZone) {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (let i = 0; i < 2; i++) {
    const parts = dtf.formatToParts(guess).reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
    const hourPart = parts.hour === '24' ? 0 : Number(parts.hour);
    const guessedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hourPart,
      Number(parts.minute),
      Number(parts.second)
    );
    const targetAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
    guess = new Date(guess.getTime() + (targetAsUtc - guessedAsUtc));
  }
  return guess;
}

// Round N starts (N-1) whole weeks after the anchor date, at the same
// Eastern wall-clock time. Recomputed per-round from the calendar date
// (never by adding milliseconds to a prior UTC instant) so a DST
// transition mid-season keeps 11:59pm Eastern fixed instead of drifting.
export function getRoundStartTime(roundNumber, firstRound) {
  const weeksToAdd = roundNumber - 1;
  const scratch = new Date(Date.UTC(firstRound.year, firstRound.month - 1, firstRound.day));
  scratch.setUTCDate(scratch.getUTCDate() + weeksToAdd * 7);
  return zonedTimeToUtc(
    scratch.getUTCFullYear(),
    scratch.getUTCMonth() + 1,
    scratch.getUTCDate(),
    firstRound.hour,
    firstRound.minute,
    TIME_ZONE
  );
}
