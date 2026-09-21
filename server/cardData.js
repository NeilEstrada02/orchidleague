import { redisClient } from './redis.js';

const SCRYFALL_COLLECTION = 'https://api.scryfall.com/cards/collection';
const SCRYFALL_HEADERS = {
  'User-Agent': 'OrchidLeagueSite/1.0',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};
const CHUNK_SIZE = 75; // Scryfall's per-request maximum
const FOUND_TTL_SECONDS = 60 * 60 * 24 * 30;
const MISSING_TTL_SECONDS = 60 * 60 * 12;
// Stay well inside Scryfall's guidelines: calls are serialized with a gap, and
// capped per minute overall no matter how many visitors ask.
const REQUEST_GAP_MS = 120;
const MAX_SCRYFALL_REQUESTS_PER_MINUTE = 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Accent-, case- and apostrophe-insensitive form used for matching and cache keys.
export const normalizeName = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const frontFace = (name) => name.split(' // ')[0];
const cacheKey = (name) => `orchid:card:${normalizeName(name)}`;

let queue = Promise.resolve();
let recentRequests = [];

function scryfallCollection(names) {
  const run = queue.then(async () => {
    const now = Date.now();
    recentRequests = recentRequests.filter((t) => now - t < 60_000);
    if (recentRequests.length >= MAX_SCRYFALL_REQUESTS_PER_MINUTE) throw new Error('scryfall_budget_exceeded');
    recentRequests.push(now);

    const res = await fetch(SCRYFALL_COLLECTION, {
      method: 'POST',
      headers: SCRYFALL_HEADERS,
      body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`scryfall_${res.status}`);
    const body = await res.json();
    await sleep(REQUEST_GAP_MS);
    return body;
  });
  queue = run.catch(() => {});
  return run;
}

// Mana value of a cost like "{2}{R}{R/G}": numbers add up, X counts as 0,
// and every colored / hybrid / Phyrexian symbol counts as 1 (or the number
// in a "{2/W}" style hybrid).
function manaValue(cost) {
  let total = 0;
  for (const [, symbol] of cost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(symbol)) total += Number(symbol);
    else if (/^[XYZ]$/.test(symbol)) total += 0;
    else if (/^\d+\//.test(symbol)) total += Number(symbol.split('/')[0]);
    else total += 1;
  }
  return total;
}

function toInfo(card) {
  const faces = card.card_faces ?? [];
  const front = faces.length > 1 ? faces[0] : null;
  const manaCost = card.layout === 'adventure' && front ? front.mana_cost ?? '' : card.mana_cost || front?.mana_cost || '';
  return {
    name: card.name,
    typeLine: front ? front.type_line : card.type_line,
    manaCost,
    cmc: front ? manaValue(front.mana_cost ?? '') : (card.cmc ?? 0),
    image: card.image_uris?.normal ?? faces[0]?.image_uris?.normal ?? null,
    layout: card.layout,
  };
}

// Scryfall matches a two-faced card by either face's name but not by the full
// "A // B" name, so everything is looked up by front face and matched back.
async function fetchFromScryfall(names) {
  const body = await scryfallCollection([...new Set(names.map(frontFace))]);
  const index = new Map();
  for (const card of body.data ?? []) {
    for (const label of [card.name, ...(card.card_faces ?? []).map((f) => f.name)]) {
      if (!index.has(normalizeName(label))) index.set(normalizeName(label), card);
    }
  }
  const resolved = new Map();
  for (const name of names) {
    const card = index.get(normalizeName(name)) ?? index.get(normalizeName(frontFace(name)));
    resolved.set(name, card ? toInfo(card) : null);
  }
  return resolved;
}

// names: card names as they appear in decklists. Returns
// { cards: { [lowercased trimmed name]: info | null }, unresolved: [keys] }.
// `null` means Scryfall doesn't know the card; `unresolved` means we couldn't
// ask (network error / budget), so the caller should try again later.
export async function lookupCards(names) {
  const wanted = new Map();
  for (const raw of names) {
    const name = raw.trim();
    if (name && !wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
  }
  const entries = [...wanted.entries()];
  const cards = {};
  const unresolved = [];
  if (entries.length === 0) return { cards, unresolved };

  const cached = await redisClient.mGet(entries.map(([, name]) => cacheKey(name)));
  const misses = [];
  entries.forEach(([key, name], i) => {
    if (cached[i]) {
      const value = JSON.parse(cached[i]);
      cards[key] = value.missing ? null : value;
    } else {
      misses.push([key, name]);
    }
  });

  for (let i = 0; i < misses.length; i += CHUNK_SIZE) {
    const chunk = misses.slice(i, i + CHUNK_SIZE);
    let resolved;
    try {
      resolved = await fetchFromScryfall(chunk.map(([, name]) => name));
    } catch (err) {
      console.error('Card lookup failed:', err.message);
      chunk.forEach(([key]) => unresolved.push(key));
      continue;
    }

    const writes = redisClient.multi();
    for (const [key, name] of chunk) {
      const info = resolved.get(name);
      cards[key] = info;
      if (info) {
        for (const alias of new Set([name, info.name, frontFace(info.name)])) {
          writes.set(cacheKey(alias), JSON.stringify(info), { EX: FOUND_TTL_SECONDS });
        }
      } else {
        writes.set(cacheKey(name), JSON.stringify({ missing: true }), { EX: MISSING_TTL_SECONDS });
      }
    }
    await writes.exec();
  }
  return { cards, unresolved };
}
