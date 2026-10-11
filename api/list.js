// Shared lists. Anyone who has a list's join code can read it and add, change or remove items.
// Storage: Upstash Redis (Vercel Marketplace > Storage > Upstash Redis). Env vars it adds:
//   KV_REST_API_URL + KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// Each list is one Redis hash: field "_meta" = {name}, fields "i:<id>" = one item each,
// so two people adding items at the same moment never overwrite each other.

// Vercel can add a custom prefix to the variable names (for example STORAGE_KV_REST_API_URL),
// so look for any variable that ends the right way instead of one exact name.
const envKeys = Object.keys(process.env);
const pick = (re) => { const k = envKeys.filter((x) => re.test(x) && !/READ_ONLY/i.test(x)).sort()[0]; return k ? process.env[k] : ""; };
const { requireUser } = require("../lib/auth.js");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pick(/(KV_REST_API_URL|REDIS_REST_URL)$/i);
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pick(/(KV_REST_API_TOKEN|REDIS_REST_TOKEN)$/i);
const TTL = 60 * 60 * 24 * 400; // lists expire after ~400 days without changes
const MAX_ITEMS = 300, MAX_ITEM_CHARS = 20000;

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const out = await r.json();
  const bad = out.find((x) => x && x.error);
  if (bad) throw new Error("storage error");
  return out.map((x) => x.result);
}

const codeOk = (c) => typeof c === "string" && /^[a-z0-9]{8,24}$/.test(c);
const idOk = (i) => /^[0-9a-z_-]{1,40}$/i.test(String(i));
const https = (u) => typeof u === "string" && /^https:\/\//i.test(u);

function cleanItem(it) {
  if (!it || typeof it !== "object" || Array.isArray(it) || !idOk(it.id)) return null;
  const o = { ...it };
  if (!["watch", "must", "bought"].includes(o.st)) o.st = "watch";
  if (o.url && !/^https?:\/\//i.test(o.url)) o.url = "";
  if (o.links && typeof o.links === "object") {
    const l = {};
    for (const k of Object.keys(o.links).slice(0, 20)) if (https(o.links[k])) l[String(k).slice(0, 40)] = o.links[k];
    o.links = l;
  } else delete o.links;
  if (o.img && !/^data:image\//i.test(o.img)) o.img = "";
  const s = JSON.stringify(o);
  return s.length <= MAX_ITEM_CHARS ? { id: String(o.id), json: s } : null;
}

async function readList(code) {
  const flat = (await redis([["HGETALL", "bfp:l:" + code]]))[0] || [];
  let name = "Shared list";
  const items = [];
  let has = false;
  for (let i = 0; i < flat.length; i += 2) {
    const f = flat[i], v = flat[i + 1];
    if (f === "_meta") { has = true; try { name = JSON.parse(v).name || name; } catch (e) {} }
    else if (f.startsWith("i:")) { try { items.push(JSON.parse(v)); } catch (e) {} }
  }
  if (!has) return null;
  items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  return { name, items };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.query && req.query.debug) {
    // Names and yes/no only, never values.
    let ping = "skipped";
    if (URL_ && TOKEN) { try { await redis([["PING"]]); ping = "ok"; } catch (e) { ping = "failed: " + String(e.message).slice(0, 60); } }
    return res.status(200).json({ storageUrlFound: !!URL_, storageTokenFound: !!TOKEN, ping, envNamesSeen: envKeys.filter((k) => /redis|kv_|upstash|storage/i.test(k)) });
  }
  if (!(await requireUser(req, res))) return; // members only
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "Sharing isn't set up on this site yet (no storage connected)." });
  try {
    if (req.method === "GET") {
      const code = String((req.query && req.query.code) || "").toLowerCase();
      if (!codeOk(code)) return res.status(400).json({ error: "Bad code" });
      const d = await readList(code);
      return d ? res.status(200).json(d) : res.status(404).json({ error: "No list found for that code." });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const b = req.body || {};
    const code = String(b.code || "").toLowerCase();
    if (!codeOk(code)) return res.status(400).json({ error: "Bad code" });
    const key = "bfp:l:" + code;

    if (b.op === "create") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
      const meta = JSON.stringify({ name: String(b.name || "Shared list").slice(0, 80) });
      const made = (await redis([["HSETNX", key, "_meta", meta]]))[0];
      if (!made) return res.status(409).json({ error: "That code is taken. Try again." });
      const cmds = items.map((x) => ["HSET", key, "i:" + x.id, x.json]);
      cmds.push(["EXPIRE", key, TTL]);
      await redis(cmds);
      return res.status(200).json(await readList(code));
    }

    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 60) : null;
    if (!ops) return res.status(400).json({ error: "Nothing to do" });
    const [exists, count] = await redis([["HEXISTS", key, "_meta"], ["HLEN", key]]);
    if (!exists) return res.status(404).json({ error: "No list found for that code." });
    const cmds = [];
    let room = MAX_ITEMS + 1 - count;
    for (const op of ops) {
      if (op.t === "put") {
        const x = cleanItem(op.item);
        if (x && room > 0) { cmds.push(["HSET", key, "i:" + x.id, x.json]); room--; }
      } else if (op.t === "del" && idOk(op.id)) cmds.push(["HDEL", key, "i:" + String(op.id)]);
      else if (op.t === "name") cmds.push(["HSET", key, "_meta", JSON.stringify({ name: String(op.name || "Shared list").slice(0, 80) })]);
    }
    if (cmds.length) { cmds.push(["EXPIRE", key, TTL]); await redis(cmds); }
    return res.status(200).json(await readList(code));
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach storage. Try again." });
  }
};
