// Owner-only: see access requests and members, approve, deny, disable or remove them.
const A = require("../lib/auth.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const me = await A.requireUser(req, res, { admin: true });
  if (!me) return;
  try {
    if (req.method === "GET") {
      const emails = ((await A.redis([["SMEMBERS", "bfp:users"]]))[0] || []).slice(0, 500);
      const rows = emails.length ? await A.redis(emails.map((e) => ["HMGET", "bfp:u:" + e, "name", "status", "note", "createdAt"])) : [];
      const users = emails.map((email, i) => ({ email, name: rows[i][0] || "", status: rows[i][1] || "", note: rows[i][2] || "", createdAt: Number(rows[i][3]) || 0 }))
        .filter((u) => u.status)
        .sort((a, b) => b.createdAt - a.createdAt);
      return res.status(200).json({ users });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const b = req.body || {};
    const email = A.normEmail(b.email);
    if (!A.emailOk(email)) return res.status(400).json({ error: "Bad email." });
    const status = { approve: "approved", deny: "denied", disable: "disabled" }[b.op];
    if (status) {
      const exists = (await A.redis([["HEXISTS", "bfp:u:" + email, "status"]]))[0];
      if (!exists) return res.status(404).json({ error: "No such member." });
      await A.redis([["HSET", "bfp:u:" + email, "status", status]]);
    } else if (b.op === "remove") {
      await A.redis([["DEL", "bfp:u:" + email], ["SREM", "bfp:users", email]]);
    } else return res.status(400).json({ error: "Unknown action." });
    A.forget(email);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: "Storage problem. Try again." });
  }
};
