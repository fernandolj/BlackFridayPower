// Sign in, sign out, request access, and "who am I".
//   GET                      -> {user} or 401
//   POST {op:"request", name, email, password, note}   ask for an account (waits for approval)
//   POST {op:"login", email, password}                 sign in (only approved members get in)
//   POST {op:"logout"}
const A = require("../lib/auth.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const problem = A.setupProblem();
  if (problem) return res.status(503).json({ error: problem, setup: true });
  try {
    if (req.method === "GET") {
      const s = await A.getSession(req);
      return s ? res.status(200).json({ user: s }) : res.status(401).json({ error: "Not signed in.", auth: true });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (req.headers["x-bfp"] !== "1") return res.status(403).json({ error: "Blocked." });
    const b = req.body || {};
    const ip = A.ip(req);

    if (b.op === "logout") { A.setCookie(req, res, "", 0); return res.status(200).json({ ok: true }); }

    const email = A.normEmail(b.email);
    const password = String(b.password || "");

    if (b.op === "login") {
      if (!(await A.allow("login-ip:" + ip, 30, 900)) || !(await A.allow("login-em:" + email, 10, 900)))
        return res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
      const bad = () => res.status(401).json({ error: "Email or password is incorrect." });
      if (!A.emailOk(email) || !password) return bad();
      if (email === A.ADMIN_EMAIL) {
        if (!A.safeEq(password, A.ADMIN_PASSWORD)) return bad();
        A.setCookie(req, res, A.makeToken(email, "admin", "Owner"), 60 * 60 * 24 * 7);
        return res.status(200).json({ user: { email, role: "admin", name: "Owner" } });
      }
      const u = (await A.redis([["HMGET", "bfp:u:" + email, "hash", "status", "name"]]))[0] || [];
      if (!u[0] || !A.checkPassword(password, u[0])) return bad();
      if (u[1] === "pending") return res.status(403).json({ error: "Your request is still waiting for approval.", status: "pending" });
      if (u[1] === "denied") return res.status(403).json({ error: "Your request wasn't approved.", status: "denied" });
      if (u[1] !== "approved") return res.status(403).json({ error: "This account is disabled.", status: "disabled" });
      A.setCookie(req, res, A.makeToken(email, "member", u[2]), 60 * 60 * 24 * 7);
      return res.status(200).json({ user: { email, role: "member", name: u[2] || "" } });
    }

    if (b.op === "request") {
      if (b.website) return res.status(200).json({ ok: true }); // hidden field only bots fill in
      if (!(await A.allow("req-ip:" + ip, 5, 3600))) return res.status(429).json({ error: "Too many requests from this network. Try again later." });
      const name = String(b.name || "").trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: "Please enter your name." });
      if (!A.emailOk(email)) return res.status(400).json({ error: "Please enter a valid email address." });
      if (password.length < 10 || password.length > 200) return res.status(400).json({ error: "Choose a password of at least 10 characters." });
      if (email === A.ADMIN_EMAIL) return res.status(400).json({ error: "That email can't be used." });
      const total = (await A.redis([["SCARD", "bfp:users"]]))[0];
      if (total >= 500) return res.status(429).json({ error: "Access requests are closed right now." });
      const made = (await A.redis([["HSETNX", "bfp:u:" + email, "status", "pending"]]))[0];
      if (made) {
        await A.redis([
          ["HSET", "bfp:u:" + email, "name", name, "hash", A.hashPassword(password), "note", String(b.note || "").trim().slice(0, 200), "createdAt", String(Date.now())],
          ["SADD", "bfp:users", email],
        ]);
      }
      // Same answer whether or not the email already existed, so nobody can probe which emails have accounts.
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown request." });
  } catch (e) {
    return res.status(502).json({ error: "Something went wrong. Try again." });
  }
};
