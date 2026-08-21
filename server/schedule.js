const TIME_ZONE = 'America/New_York';

// Round 1 kicks off Sunday, August 30, 2026 at 11:59pm Eastern.
const ROUND_1_ANCHOR = { year: 2026, month: 8, day: 30, hour: 23, minute: 59 };

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
export function getRoundStartTime(roundNumber) {
  const weeksToAdd = roundNumber - 1;
  const scratch = new Date(Date.UTC(ROUND_1_ANCHOR.year, ROUND_1_ANCHOR.month - 1, ROUND_1_ANCHOR.day));
  scratch.setUTCDate(scratch.getUTCDate() + weeksToAdd * 7);
  return zonedTimeToUtc(
    scratch.getUTCFullYear(),
    scratch.getUTCMonth() + 1,
    scratch.getUTCDate(),
    ROUND_1_ANCHOR.hour,
    ROUND_1_ANCHOR.minute,
    TIME_ZONE
  );
}
