# er-connect

The public "Setup & Connect" page for **CI Companion**, meant to be served at
**er.ci.computer**. Plain static HTML/CSS/JS — no build step, no framework,
no dependency on the private `@companionintelligence/*` packages (the canon
color tokens are hardcoded from `ci-glasses-app/src/ui/styles.css`, since this
site has no npm install step of its own).

## Preview locally

```bash
npx serve er-connect
# or just open er-connect/index.html directly in a browser
```

## Deploy

Ships to [Cloudflare Pages](https://pages.cloudflare.com/) via
`.github/workflows/deploy-er-connect.yml`. Like the rest of this repo's CI
(see [`docs/CI.md`](../docs/CI.md)), the workflow is **gated to manual
dispatch** — it does not run automatically on push:

```bash
gh workflow run deploy-er-connect.yml --repo companionintelligence/CI-Even-Realities --ref main
```

### One-time setup (needs Cloudflare account access)

This repo's CI has no Cloudflare credentials configured yet — an org member
with Cloudflare access needs to do the following once:

1. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — a token with `Cloudflare Pages:Edit` permission
     on the account that owns the `ci.computer` zone.
   - `CLOUDFLARE_ACCOUNT_ID` — that account's ID (Cloudflare dashboard →
     Workers & Pages → Overview, right sidebar).
2. **First deploy** — run the workflow above once. `wrangler pages deploy`
   creates the `ci-er-connect` Pages project automatically if it doesn't
   exist yet.
3. **Custom domain** — in the Cloudflare dashboard, open the `ci-er-connect`
   Pages project → **Custom domains** → **Set up a custom domain** →
   `er.ci.computer`. Cloudflare adds the CNAME to the `ci.computer` zone's DNS
   automatically (the zone must already live on the same account). This step
   can't be done from CI — it's a one-time dashboard action (or
   `wrangler pages domain add er.ci.computer --project-name=ci-er-connect`
   for whoever holds the account credentials).

Once the custom domain is attached, every subsequent `workflow_dispatch` run
updates the live site at `er.ci.computer`.

## Files

- `index.html` — the whole page (content + inline styles + a tiny copy-to-clipboard script).
- `assets/` — shared app icon, copied from `ci-glasses-app/assets/icons/` (favicon, apple-touch-icon, hero mark).
- `_headers` — Cloudflare Pages security headers (CSP, frame/referrer policy).
