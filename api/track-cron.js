// Runs once a day (see vercel.json). Saves today's cheapest price for every tracked product.
// If you set a CRON_SECRET environment variable in Vercel, only Vercel's scheduler can call this.
const { lookup } = require("../lib/prices-core.js");
const { redis, today, recordToday, STALE_DAYS } = require("../lib/track.js");
const { configured } = require("../lib/redis.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== "Bearer " + secret) return res.status(401).json({ error: "Not allowed" });
  if (!configured) return res.status(503).json({ error: "No storage connected." });
  const started = Date.now();
  try {
    await redis([["ZREMRANGEBYSCORE", "bfp:tracked", "-inf", Date.now() - STALE_DAYS * 864e5]]);
    const keys = (await redis([["ZRANGE", "bfp:tracked", 0, -1]]))[0] || [];
    const day = today();
    let saved = 0, skipped = 0, failed = 0, left = 0;
    for (let i = 0; i < keys.length; i += 3) {
      if (Date.now() - started > 45000) { left = keys.length - i; break; } // stay inside the time limit; the rest wait for tomorrow
      await Promise.all(keys.slice(i, i + 3).map(async (k) => {
        try {
          if ((await redis([["HEXISTS", "bfp:h:" + k, day]]))[0]) { skipped++; return; }
          const { offers } = await lookup(k);
          (await recordToday(k, offers)) ? saved++ : failed++;
        } catch (e) { failed++; }
      }));
    }
    return res.status(200).json({ day, tracked: keys.length, saved, skipped, failed, left });
  } catch (e) {
    return res.status(502).json({ error: "Storage problem." });
  }
};
