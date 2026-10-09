# Black Friday Power

A dark, mobile-friendly Black Friday wishlist. Search an item and the site asks several store APIs at the same time, then shows each store's current price with a direct link to the product, the cheapest store, and the time the prices were pulled. Items can move between Watch, Must Buy and Bought lists.

## Deploy on Vercel

1. Import this repository at https://vercel.com/new (framework preset: **Other**, no build command).
2. Under **Settings > Environment Variables**, add the keys for the stores you want. Every key is optional; a store with no key is skipped.
3. Deploy (or redeploy after adding keys).

## Store APIs

| Store | Environment variables | Where to get them | Cost |
|---|---|---|---|
| Best Buy | `BESTBUY_API_KEY` | https://developer.bestbuy.com | Free key |
| eBay | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | https://developer.ebay.com (create a keyset) | Free; daily call limits apply |
| Walmart and Amazon | `SERPAPI_KEY` | https://serpapi.com | 250 free searches a month, then paid. One lookup uses 2 searches. |

Not included, and why:
- **Amazon's own API** needs an approved Associates account with 10 qualifying sales in 30 days.
- **Walmart's own API** is approval-only for affiliates and sellers.
- **Target** has no public product API. Its website's internal API is against its terms of use.

Target, Newegg, B&H, Apple and Costco still get a link to that store's search results.

## How it works

- `public/index.html` is the whole app. Lists are saved in the browser (localStorage).
- `api/prices.js` is a serverless function that queries every configured store at once and returns the best match from each. The match is each store's top search result, so check the title on the store page.

## Limits

- No price history yet. "Lowest seen" and "Highest seen" compare the stores' prices on the day you searched. Real history needs a database and a scheduled daily job.
- Prices are only as fresh as the last search. There is no automatic daily refresh yet.
- Lists are per browser, not shared across devices or people.
- The price endpoint is public and uses your API quotas. Add rate limiting before sharing the link widely.
- Best Buy's terms allow only temporary caching of its data, so check them before storing its prices.
