// Price tracking storage. One record per product per day, kept in Redis.
//   bfp:tracked        sorted set: product key -> last time someone had it on a list
//   bfp:h:<key>        hash: "YYYY-MM-DD" -> {p: cheapest price, s: store, n: number of stores}
const { redis } = require("./redis.js");

const TTL = 60 * 60 * 24 * 400;
const MAX_TRACKED = 60;          // protects your API quota
const STALE_DAYS = 60;           // stop tracking products nobody has had on a list for this long

const normKey = (q) => String(q || "").toLowerCase().replace(/[®™©]/g, " ").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);
const today = () => new Date().toISOString().slice(0, 10);

async function readSeries(key) {
  const flat = (await redis([["HGETALL", "bfp:h:" + key]]))[0] || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { const v = JSON.parse(flat[i + 1]); out.push({ d: flat[i], p: v.p, s: v.s, n: v.n || 1, st: v.st, u: v.u }); } catch (e) {}
  }
  out.sort((a, b) => (a.d < b.d ? -1 : 1));
  // Only the newest day carries the per-store prices and links, to keep replies small.
  out.forEach((x, i) => { if (i < out.length - 1) { delete x.st; delete x.u; } });
  return out;
}

// Save today's cheapest price (from a lookup's offers). Overwrites earlier saves from the same day.
async function recordToday(key, offers) {
  if (!offers || !offers.length) return false;
  const best = offers.reduce((a, b) => (b.price < a.price ? b : a));
  const st = {}, u = {};
  offers.forEach((o) => { st[o.store] = o.price; if (o.url) u[o.store] = o.url; });
  await redis([
    ["HSET", "bfp:h:" + key, today(), JSON.stringify({ p: best.price, s: best.store, n: offers.length, st, u })],
    ["EXPIRE", "bfp:h:" + key, TTL],
  ]);
  return true;
}

module.exports = { redis, normKey, today, readSeries, recordToday, MAX_TRACKED, STALE_DAYS };
