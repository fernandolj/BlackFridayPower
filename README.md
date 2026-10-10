# Black Friday Power

A dark, mobile-friendly Black Friday wishlist. Search an item and the site asks OpenWeb Ninja's two APIs at the same time, then shows each store's current price with a direct link to the offer, the cheapest store, and the time the prices were pulled. Items can move between Watch, Must Buy and Bought lists.

## Deploy on Vercel

1. Import this repository at https://vercel.com/new (framework preset: **Other**, no build command).
2. Under **Settings > Environment Variables**, add:
   - `OPENWEBNINJA_PRODUCT_KEY`: your Real-Time Product Search key (Walmart, Target, Best Buy, eBay and other stores)
   - `OPENWEBNINJA_AMAZON_KEY`: your Real-Time Amazon Data key (Amazon)
   - If both APIs use one account key, set only `OPENWEBNINJA_API_KEY` instead.
3. Deploy, or redeploy after adding the keys. Never put keys in the code or in GitHub.

## Shared lists (join codes)

Anyone with a list's join code can open it and see, add, change and remove items. Private lists stay in each person's own browser. Shared lists need a small database:

1. In your Vercel project, open **Storage** and add **Upstash Redis** (Marketplace). Connect it to this project. The free plan is enough to start.
2. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Redeploy.
3. In the app, open a list and tap **Share** to get a join code. Others tap **Join** and enter it.

There is no sign-in. The join code is the only key, so treat it like a password. Shared lists refresh about every 8 seconds and are removed after about 400 days without changes.

## Checking that it works

Open `https://YOUR-SITE.vercel.app/api/prices?q=ps5&debug=1`. It shows each API's HTTP status and the shape of its reply (never your keys). If a store shows `error` or `no match`, that output tells us what to adjust.

## How it works

- `public/index.html` is the whole app. Lists are saved in the browser (localStorage).
- `api/list.js` stores shared lists in Upstash Redis.
- `api/prices.js` calls both APIs in parallel and keeps the best-ranked match from each store.

## Limits

- Each store's price is the top-ranked search match, so confirm the product on the store page.
- No price history yet. "Lowest seen" and "Highest seen" compare store prices on the day you searched. The Product Search API has a price history feature that can be wired in once its endpoint is confirmed.
- No automatic daily refresh. Prices update when you search again.
- Private lists are per browser. Use a shared list to see the same items on another device.
- The price endpoint is public and uses your API quota. Add rate limiting before sharing the link widely.
