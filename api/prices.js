// Price lookup endpoint. The work is in lib/prices-core.js so the daily tracker can reuse it.
const { lookup, cleanQuery } = require("../lib/prices-core.js");
const { requireUser } = require("../lib/auth.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Members only, and each member gets 40 lookups an hour so nobody can run up your API bill.
  if (!(await requireUser(req, res, { limit: ["lookup", 40, 3600] }))) return;
  const q = cleanQuery(req.query && req.query.q);
  if (q.length < 2) return res.status(400).json({ error: "Missing q" });
  const dbg = req.query && req.query.debug ? {} : null;
  if (dbg) dbg.envNamesSeen = Object.keys(process.env).filter((k) => /openweb|ninja/i.test(k)); // names only, never values
  const { offers, status } = await lookup(q, dbg);
  res.status(200).json({ query: q, offers, status, ...(dbg ? { debug: dbg } : {}) });
};
