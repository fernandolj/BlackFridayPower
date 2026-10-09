# Black Friday Power

A dark, mobile-friendly Black Friday wishlist: add items, see estimated current / lowest / highest prices and a 12-month history, move items to Must Buy or Bought, and keep several lists.

## Deploy on Vercel

1. Go to https://vercel.com/new and import this GitHub repository.
2. Leave the framework preset as **Other**. No build command is needed (`vercel.json` serves the `public` folder and the `api` function).
3. Under **Environment Variables**, add `ANTHROPIC_API_KEY` (from https://console.anthropic.com). Optional: `ANTHROPIC_MODEL` to override the default model.
4. Click **Deploy**.

## How it works

- `public/index.html` is the whole app. Lists are saved in the browser (localStorage) when hosted.
- `api/sample.js` is a serverless function that asks Claude for the product estimate (prices, history, description, icon).

## Limits to know about

- Prices, history and links are **Claude's estimates, not live store data**. Links open each store's search results. Exact prices and direct product pages need a retailer or price-data API.
- Hosted lists live in each person's own browser, so they are not shared across devices or with other people. Sharing and sync need a database and sign-in.
- The lookup endpoint is public and uses your API key; add rate limiting or sign-in before sharing the URL widely.
