// Vercel serverless function: gets prices from OpenWeb Ninja's two APIs at the same time.
//   Real-Time Product Search  -> Walmart, Target, Best Buy, eBay and other stores
//   Real-Time Amazon Data     -> Amazon
// Env vars (set in Vercel > Settings > Environment Variables):
//   OPENWEBNINJA_PRODUCT_KEY   key for Real-Time Product Search
//   OPENWEBNINJA_AMAZON_KEY    key for Real-Time Amazon Data
// If both APIs use one account key, set only OPENWEBNINJA_API_KEY and it is used for both.
// Add ?debug=1 to see each API's HTTP status and the shape of its reply (never the keys).

const TIMEOUT_MS = 9000;
const BASE = "https://api.openwebninja.com";
const money = (v) => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : 0;
};
const httpUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : "");
const KNOWN = [["best buy", "Best Buy"], ["walmart", "Walmart"], ["target", "Target"], ["amazon", "Amazon"], ["ebay", "eBay"], ["newegg", "Newegg"], ["b&h", "B&H"], ["bhphoto", "B&H"], ["apple", "Apple"], ["costco", "Costco"], ["home depot", "Home Depot"], ["lowe", "Lowe's"], ["sam's club", "Sam's Club"], ["micro center", "Micro Center"], ["dell", "Dell"], ["gamestop", "GameStop"], ["macy", "Macy's"], ["kohl", "Kohl's"], ["wayfair", "Wayfair"]];
const storeName = (s) => {
  const t = String(s || "").trim();
  const l = t.toLowerCase();
  for (const [k, v] of KNOWN) if (l.includes(k)) return v;
  return t.slice(0, 40);
};

// Find the store's own product page. Try the known field names first, then any other
// field named like a url or link (skipping images, reviews and Google pages).
function offerLink(o, store) {
  if (!o || typeof o !== "object") return "";
  for (const k of ["offer_page_url", "offer_url", "url", "link", "product_url", "merchant_url"]) {
    const u = httpUrl(o[k]);
    if (u && !/(^|\.)google\./i.test(new URL(u).hostname)) return u;
  }
  for (const k of Object.keys(o)) {
    if (!/url|link/i.test(k) || /photo|image|thumb|video|review|rating|logo|icon|shipping|return|policy|terms|store|merchant|seller|google/i.test(k)) continue;
    const u = httpUrl(o[k]);
    if (!u) continue;
    const host = new URL(u).hostname.toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = String(store || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    if (!/google/.test(host) && (!want || host.includes(want))) return u; // fallback scan: the page must be on that store's own site
  }
  return "";
}
const key = (specific) => process.env[specific] || process.env.OPENWEBNINJA_API_KEY || "";

// The docs were not machine-readable when this was written, so find the result list wherever it sits.
function listOf(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== "object") return [];
  for (const k of ["data", "products", "results", "items"]) {
    const v = j[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") { const r = listOf(v); if (r.length) return r; }
  }
  return [];
}

async function call(path, params, apiKey, dbg, name) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BASE + path + "?" + new URLSearchParams(params), { headers: { "x-api-key": apiKey }, signal: ctl.signal });
    const body = await r.json().catch(() => null);
    if (dbg) {
      const l = listOf(body);
      dbg[name] = { http: r.status, topKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 12) : null, items: l.length, firstItemKeys: l[0] ? Object.keys(l[0]).slice(0, 30) : null, firstOfferKeys: l[0] && l[0].offer ? Object.keys(l[0].offer).slice(0, 30) : null };
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return body;
  } finally {
    clearTimeout(t);
  }
}

const providers = {
  // One search returns products from many stores; keep the best-ranked match per store.
  async stores(q, dbg) {
    const k = key("OPENWEBNINJA_PRODUCT_KEY");
    if (!k) return null;
    const body = await call("/realtime-product-search/v2/search", { q, country: "us", language: "en" }, k, dbg, "productSearch");
    const seen = new Set(), out = [];
    for (const it of listOf(body)) {
      const o = it.offer || (Array.isArray(it.offers) && it.offers[0]) || it;
      const store = storeName(o.store_name || it.store_name);
      const link = offerLink(o, store) || offerLink(it, store);
      const price = money(o.price != null ? o.price : it.price);
      if (!store || !price || seen.has(store)) continue;
      seen.add(store);
      const photo = Array.isArray(it.product_photos) ? it.product_photos[0] : it.product_photo;
      out.push({ store, title: it.product_title || o.offer_title || "", price, url: link, image: httpUrl(photo) });
    }
    return out;
  },
  async amazon(q, dbg) {
    const k = key("OPENWEBNINJA_AMAZON_KEY");
    if (!k) return null;
    const body = await call("/realtime-amazon-data/search", { query: q, country: "US" }, k, dbg, "amazonSearch");
    const p = listOf(body).find((x) => money(x.product_price) && httpUrl(x.product_url) && !x.is_sponsored);
    return p ? [{ store: "Amazon", title: p.product_title || "", price: money(p.product_price), url: httpUrl(p.product_url), image: httpUrl(p.product_photo) }] : [];
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = String((req.query && req.query.q) || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Missing q" });
  const dbg = req.query && req.query.debug ? {} : null;
  if (dbg) dbg.envNamesSeen = Object.keys(process.env).filter((k) => /openweb|ninja/i.test(k)); // names only, never values
  const names = Object.keys(providers);
  const settled = await Promise.allSettled(names.map((n) => providers[n](q, dbg)));
  const status = {}, byStore = new Map();
  settled.forEach((r, i) => {
    if (r.status === "rejected") status[names[i]] = "error";
    else if (r.value === null) status[names[i]] = "not configured";
    else if (!r.value.length) status[names[i]] = "no match";
    else { status[names[i]] = "ok"; r.value.forEach((o) => { if (!byStore.has(o.store)) byStore.set(o.store, { ...o, at: Date.now() }); }); }
  });
  const offers = [...byStore.values()].sort((a, b) => a.price - b.price).slice(0, 8);
  res.status(200).json({ query: q, offers, status, ...(dbg ? { debug: dbg } : {}) });
};
