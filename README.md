# Black Friday Power

A dark, mobile-friendly Black Friday wishlist. Search an item and the site asks OpenWeb Ninja's two APIs at the same time, then shows each store's current price with a direct link to the offer, the cheapest store, and the time the prices were pulled. Items can move between Watch, Must Buy and Bought lists.

## Accounts (members only)

The whole site and every API are locked behind accounts. People ask for access, you approve them, and only then can they sign in. Add these three environment variables in Vercel (Settings > Environment Variables), then redeploy:

| Name | What to put |
|---|---|
| `SESSION_SECRET` | Any long random text, at least 24 characters. It signs the sign-in cookie. Never share it. |
| `ADMIN_EMAIL` | Your email. This is the owner account. |
| `ADMIN_PASSWORD` | Your password, at least 10 characters. |
| `CRON_SECRET` | Any random text, at least 16 characters. Required for the daily price job. |

How it works:
- Visitors see a sign-in screen. **Request access** sends their name, email and chosen password (stored hashed) to you.
- Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then tap **Members** at the bottom of the page. Approve, deny, disable or remove people there. A button shows how many requests are waiting.
- Approved members sign in with the password they chose. A disabled or removed member loses access within about a minute.
- Each member can make 40 price lookups an hour, so nobody can run up your API bill.
- There is no email notification yet: check the Members button for new requests.
- Passwords can't be reset by email. If someone forgets theirs, remove them and they can request access again.

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

Only signed-in members can use shared lists, and the join code is also needed, so treat it like a password. Shared lists refresh about every 8 seconds and are removed after about 400 days without changes.

## Daily price tracking and automatic Must Buy

When an item is added, the site saves that product's cheapest price for the day. A daily job (`vercel.json`, 9:00 UTC) saves a new price every day after that, so each item builds its own real price history. This uses the same Upstash Redis storage as shared lists.

- **Must Buy move:** after at least 3 earlier days of history, a watched item moves to Must Buy by itself when today's cheapest price is a new low since tracking began, or is 10% or more under its usual (median) price. The card says why. If you move it back to Watching, it only moves again on a still lower price.
- **Prices on cards** (best price, compare stores, links, lowest and highest seen) come from the latest saved day.
- **Needs** the `CRON_SECRET` environment variable (see Accounts) so only Vercel's scheduler can run the daily job.
- **Quota:** each tracked product uses about 3 OpenWeb Ninja requests a day. The site tracks at most 60 products and drops ones nobody has had on a list for 60 days.
- The history is saved per product, not per person, so everyone tracking the same product shares one history.

## Checking that it works

Open `https://YOUR-SITE.vercel.app/api/prices?q=ps5&debug=1`. It shows each API's HTTP status and the shape of its reply (never your keys). If a store shows `error` or `no match`, that output tells us what to adjust.

## How it works

- `public/index.html` is the whole app. Lists are saved in the browser (localStorage).
- `api/auth.js` and `api/admin.js` handle sign-in and approvals; `lib/auth.js` checks every request.
- `api/track.js` and `api/track-cron.js` save and serve the daily price history.
- `api/list.js` stores shared lists in Upstash Redis.
- `api/prices.js` calls both APIs in parallel and keeps the best-ranked match from each store.

## Limits

- Each store's price is the top-ranked search match, so confirm the product on the store page.
- Price history starts the day an item is first tracked; it cannot look back before that.
- Prices refresh once a day by the scheduled job (Vercel Hobby allows one run a day, at a time within about an hour of the schedule).
- Private lists are per browser. Use a shared list to see the same items on another device.
