// Vercel serverless function: asks every configured store API at the same time and returns
// the best match from each. A store with no key set is skipped. Needs no Claude/Anthropic key.
//
// Env vars (all optional, set the ones you have):
//   BESTBUY_API_KEY                      Best Buy Developer API (free key)
//   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET   eBay Browse API (free developer keyset)
//   SERPAPI_KEY                          SerpApi, used for Walmart and Amazon search (250 free searches/month)

const TIMEOUT_MS = 8000;
const money = (v) => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : 0;
};
const httpUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : "");
async function getJSON(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const providers = {
  async bestbuy(q) {
    const key = process.env.BESTBUY_API_KEY;
    if (!key) return null;
    const term = q.split(/\s+/).filter(Boolean).slice(0, 8).map((w) => "search=" + encodeURIComponent(w)).join("&");
    const url = `https://api.bestbuy.com/v1/products((${term})&onlineAvailability=true)?apiKey=${encodeURIComponent(key)}&format=json&pageSize=3&sort=salesRankShortTerm.asc&show=name,salePrice,url,image`;
    const d = await getJSON(url);
    const p = (d.products || []).find((x) => money(x.salePrice) && httpUrl(x.url));
    return p && { store: "Best Buy", title: p.name, price: money(p.salePrice), url: httpUrl(p.url), image: httpUrl(p.image) };
  },
  async ebay(q) {
    const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
    if (!id || !secret) return null;
    const tok = await getJSON("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64") },
      body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    });
    const d = await getJSON(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=5&filter=${encodeURIComponent("conditions:{NEW},buyingOptions:{FIXED_PRICE}")}&sort=price`, {
      headers: { authorization: "Bearer " + tok.access_token, "x-ebay-c-marketplace-id": "EBAY_US" },
    });
    const items = (d.itemSummaries || []).filter((x) => money(x.price && x.price.value) && httpUrl(x.itemWebUrl));
    // sort=price puts accessories first, so take the median-priced new listing instead of the cheapest
    const p = items[Math.floor(items.length / 2)];
    return p && { store: "eBay", title: p.title, price: money(p.price.value), url: httpUrl(p.itemWebUrl), image: httpUrl(p.image && p.image.imageUrl) };
  },
  async walmart(q) {
    const key = process.env.SERPAPI_KEY;
    if (!key) return null;
    const d = await getJSON(`https://serpapi.com/search.json?engine=walmart&query=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`);
    const p = (d.organic_results || []).find((x) => money(x.primary_offer && x.primary_offer.offer_price) && httpUrl(x.product_page_url));
    return p && { store: "Walmart", title: p.title, price: money(p.primary_offer.offer_price), url: httpUrl(p.product_page_url), image: httpUrl(p.thumbnail) };
  },
  async amazon(q) {
    const key = process.env.SERPAPI_KEY;
    if (!key) return null;
    const d = await getJSON(`https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(q)}&amazon_domain=amazon.com&api_key=${encodeURIComponent(key)}`);
    const p = (d.organic_results || []).find((x) => !x.sponsored && money(x.extracted_price || x.price) && httpUrl(x.link));
    return p && { store: "Amazon", title: p.title, price: money(p.extracted_price || p.price), url: httpUrl(p.link), image: httpUrl(p.thumbnail) };
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = String((req.query && req.query.q) || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Missing q" });
  const names = Object.keys(providers);
  const settled = await Promise.allSettled(names.map((n) => providers[n](q)));
  const status = {}, offers = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") status[names[i]] = "error";
    else if (r.value === null) status[names[i]] = "not configured";
    else if (!r.value) status[names[i]] = "no match";
    else { status[names[i]] = "ok"; offers.push({ ...r.value, at: Date.now() }); }
  });
  offers.sort((a, b) => a.price - b.price);
  res.status(200).json({ query: q, offers, status });
};
