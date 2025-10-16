# Swipey Auto-Signup (Vercel + Browserless + Playwright)

One-page landing that collects all fields and submits the two-step signup at
`https://affiliate.swipey.ai/signup` by automating a real browser session.

## Why this works on Vercel
Vercel serverless functions cannot bundle & run full Chromium/Playwright.
We **do not** run a browser on Vercel. Instead, we connect to **Browserless**
(cloud-hosted headless Chrome) via WebSocket using **Playwright**.

## Env Vars
Create **.env** in project root (and set in Vercel dashboard):
```
BROWSERLESS_WS=wss://production-ams.browserless.io?token=YOUR_API_TOKEN&stealth=true
```
- Pick the closest region (AMS/LON/SFO). See Browserless docs.
- The `stealth=true` flag enables anti-bot evasions on Browserless.

## Deploy
1. `vercel` (or import repo in Vercel UI)
2. In Project → Settings → Environment Variables add `BROWSERLESS_WS`.
3. Deploy. Open `/` for the form. It posts to `/signup-proxy` (rewritten to the serverless API).

## Notes
- If Swipey changes DOM or adds extra validations/CAPTCHA, update selectors in `api/signup-proxy.js`.
- This is a best-effort automation: we're not bypassing captchas, just filling fields like a user.
- Do not store PII in logs. Add your own rate-limits and captcha on the landing if needed.
