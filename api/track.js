// Price history endpoint.
//   POST {q}   start tracking a product (called when an item is added) and save today's first price
//   GET ?q=..&q=..   read the saved daily prices for up to 12 products
const { lookup, cleanQuery } = require("../lib/prices-core.js");
const { redis, normKey, today, readSeries, recordToday, MAX_TRACKED } = require("../lib/track.js");
const { configured } = require("../lib/redis.js");
const { requireUser } = require("../lib/auth.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!(await requireUser(req, res, req.method === "POST" ? { limit: ["track", 30, 3600] } : {}))) return;
  if (!configured) return res.status(503).json({ error: "Price tracking needs the Upstash Redis storage connected." });
  try {
    if (req.method === "GET") {
      let qs = req.query && req.query.q;
      qs = (Array.isArray(qs) ? qs : qs ? [qs] : []).slice(0, 12);
      const series = {};
      await Promise.all(qs.map(async (q) => { const k = normKey(q); if (k.length >= 2) series[k] = await readSeries(k); }));
      return res.status(200).json({ series });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const q = cleanQuery(req.body && req.body.q);
    const key = normKey(q);
    if (key.length < 2) return res.status(400).json({ error: "Missing q" });
    const known = (await redis([["ZSCORE", "bfp:tracked", key]]))[0];
    if (known == null) {
      const n = (await redis([["ZCARD", "bfp:tracked"]]))[0];
      if (n >= MAX_TRACKED) return res.status(429).json({ error: "This site is already tracking the most products it can." });
    }
    await redis([["ZADD", "bfp:tracked", Date.now(), key]]);
    const have = (await redis([["HEXISTS", "bfp:h:" + key, today()]]))[0];
    if (!have) {
      const { offers } = await lookup(q); // our own lookup, so nobody can post fake prices
      await recordToday(key, offers);
    }
    return res.status(200).json({ key, series: await readSeries(key) });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach storage. Try again." });
  }
};
