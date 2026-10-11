// Accounts: people request access, the owner approves them, only approved members can use the site.
// Environment variables (set in Vercel > Settings > Environment Variables):
//   SESSION_SECRET   long random text; signs the sign-in cookie            (required)
//   ADMIN_EMAIL      the owner's email                                      (required)
//   ADMIN_PASSWORD   the owner's password (10+ characters)                  (required)
const crypto = require("crypto");
const { redis, configured } = require("./redis.js");

const SECRET = process.env.SESSION_SECRET || "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const COOKIE = "bfp_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

const setupProblem = () =>
  !configured ? "Accounts need the Upstash Redis storage connected."
  : SECRET.length < 24 ? "Accounts need a SESSION_SECRET environment variable (at least 24 random characters)."
  : !ADMIN_EMAIL || ADMIN_PASSWORD.length < 10 ? "Accounts need ADMIN_EMAIL and an ADMIN_PASSWORD (10+ characters) environment variables."
  : "";

const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 120);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const b64u = (b) => Buffer.from(b).toString("base64url");
const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// ---- passwords (scrypt, a slow hash made for passwords) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return "s1$" + salt.toString("base64") + "$" + crypto.scryptSync(pw, salt, 64).toString("base64");
}
function checkPassword(pw, stored) {
  try {
    const [v, salt, hash] = String(stored).split("$");
    if (v !== "s1") return false;
    const got = crypto.scryptSync(pw, Buffer.from(salt, "base64"), 64);
    return crypto.timingSafeEqual(got, Buffer.from(hash, "base64"));
  } catch (e) { return false; }
}

// ---- signed sign-in cookie ----
function makeToken(email, role, name) {
  const body = b64u(JSON.stringify({ e: email, r: role, n: name || "", x: Math.floor(Date.now() / 1000) + SESSION_SECONDS }));
  return body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}
function readToken(tok) {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    return d.x > Date.now() / 1000 ? d : null;
  } catch (e) { return null; }
}
const cookieOf = (req) => {
  const m = String((req.headers && req.headers.cookie) || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  return m ? m[1] : "";
};
function setCookie(req, res, value, maxAge) {
  const host = String((req.headers && req.headers.host) || "");
  const secure = /^localhost|^127\./.test(host) ? "" : "; Secure";
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

// Member status is re-checked from storage (cached 60 seconds per server) so a disabled member loses access quickly.
const cache = new Map();
async function userStatus(email) {
  const hit = cache.get(email);
  if (hit && hit.t > Date.now() - 60000) return hit.v;
  const v = (await redis([["HMGET", "bfp:u:" + email, "status", "name"]]))[0] || [];
  const out = { status: v[0] || "", name: v[1] || "" };
  cache.set(email, { t: Date.now(), v: out });
  return out;
}
const forget = (email) => cache.delete(email);

async function getSession(req) {
  if (setupProblem()) return null;
  const d = readToken(cookieOf(req));
  if (!d || !d.e) return null;
  if (d.r === "admin") return d.e === ADMIN_EMAIL ? { email: d.e, role: "admin", name: d.n || "Owner" } : null;
  const u = await userStatus(d.e);
  return u.status === "approved" ? { email: d.e, role: "member", name: u.name } : null;
}

const ip = (req) => String((req.headers && req.headers["x-forwarded-for"]) || "unknown").split(",")[0].trim().slice(0, 60);

// Allow `max` hits per `windowSec` for this key. Returns false once the limit is passed.
async function allow(key, max, windowSec) {
  const r = await redis([["INCR", "bfp:rl:" + key], ["EXPIRE", "bfp:rl:" + key, windowSec, "NX"]]);
  return r[0] <= max;
}

// For protected endpoints: returns the member, or sends the error and returns null.
async function requireUser(req, res, opts = {}) {
  const problem = setupProblem();
  if (problem) { res.status(503).json({ error: problem }); return null; }
  const s = await getSession(req);
  if (!s) { res.status(401).json({ error: "Please sign in.", auth: true }); return null; }
  if (req.method === "POST" && !(req.headers["x-bfp"] === "1")) { res.status(403).json({ error: "Blocked." }); return null; }
  if (opts.admin && s.role !== "admin") { res.status(403).json({ error: "Owner only." }); return null; }
  if (opts.limit) {
    const [bucket, max, win] = opts.limit;
    if (!(await allow(bucket + ":" + s.email, max, win))) { res.status(429).json({ error: "Too many requests. Please wait a bit and try again." }); return null; }
  }
  return s;
}

module.exports = { setupProblem, normEmail, emailOk, safeEq, hashPassword, checkPassword, makeToken, setCookie, getSession, requireUser, allow, ip, forget, ADMIN_EMAIL, ADMIN_PASSWORD, redis };
