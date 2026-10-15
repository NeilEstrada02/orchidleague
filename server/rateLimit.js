// Small in-memory fixed-window limiters. Each server process keeps its own
// counts, which is enough here: the point is to keep one source (or the whole
// public) from running up the database bill, not to meter users precisely.

// Cloudflare fronts the site and sets this header to the real visitor's
// address, replacing anything the visitor sent. When it's missing there is no
// per-visitor identity we can trust (every request would look like it came
// from the proxy), so callers should skip per-visitor limits rather than
// lump everyone together.
export function clientId(req) {
  return req.headers['cf-connecting-ip'] || null;
}

const MAX_TRACKED_KEYS = 50_000;

// Returns allow(key = 'all'): true while `key` has made fewer than `max`
// calls in the current window.
export function createWindowLimiter({ windowMs, max }) {
  let windowStart = Date.now();
  let counts = new Map();
  return function allow(key = 'all') {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      counts = new Map();
    }
    const used = counts.get(key) ?? 0;
    if (used >= max) return false;
    // Bounded memory under a flood from huge numbers of sources: past the
    // cap, new sources simply aren't tracked.
    if (used > 0 || counts.size < MAX_TRACKED_KEYS) counts.set(key, used + 1);
    return true;
  };
}
