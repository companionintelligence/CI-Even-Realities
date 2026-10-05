# er-connect

The public "Setup & Connect" app for **CI Companion**, live at
**[er.ci.computer](https://er.ci.computer)**. A real Vite + React app now —
not a hand-styled static page — built on the canonical
[`@companionintelligence/ui`](https://github.com/companionintelligence/CI-Common/tree/main/packages/ui)
component kit and [`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/styles/tokens),
so it renders the real CI phthalo/sage palette, the real logo mark, and the
same Button/Card/Dialog/Stepper/StatusPill primitives every other CI surface
uses, instead of a hand-approximated copy.

- **Install** — honest about status: CI Companion is a **developer preview**
  with no public store listing or `.ehpk` release yet, so this step points at the
  [docs install steps](https://docs.ci.computer/docs/apps-available/first-party-apps/even-realities#install-the-app)
  and the Discord instead of a store link. Put the real listing link here
  (and bring back a QR code) only once a listing exists.
- **Cross-links** — the logo and footer go to <https://ci.computer>; the hero and
  Connect step carry **Buy Companion Core** (<https://ci.computer/core>) and
  **Download Companion** (<https://ci.computer/download>); **Docs** links to the
  matching docs page. Every URL lives in `src/links.ts`.
- **Sign in** — real Authorization Code + PKCE flow against CI-Portal
  (`https://hub.ci.computer/api/auth`), mirroring
  `ci-glasses-app/src/auth/OidcClient.ts`.
- **Connect your Hub** — a `Stepper` walks Install → Connect → Talk. Once
  you've entered a Hub address it is remembered in `localStorage`. The
  sign-in itself lives in `sessionStorage` (this tab only; closing the tab
  signs out), and a remembered address plus a live sign-in reconnect
  automatically on reload.
- **Help** — everything explanatory (how it works, screenshots, manual
  backend config, supported Backend Kinds, troubleshooting) lives behind a
  `Dialog` with tabs, out of the main flow.

## Why a build step

This used to be plain HTML/CSS/JS with hand-copied hex values standing in
for the real canon palette — `--bg: #060606` where the real dark background
is `#041620`, a teal-black, not near-black. CI-Common's own governance
(`styles/UI-STYLE-GUIDE.md` §11) calls that exact pattern the drift its
token bundle exists to prevent: *"Consume the package; never copy a token
block... A hand-copied block is exactly the drift the gate exists to
catch."* Pulling in the real `@companionintelligence/ui` kit means a real
npm install against the private `@companionintelligence` registry, and
Tailwind v4 needs a build step to generate its utility classes — so this is
now a proper app, not a static file.

## Develop

```bash
cd er-connect
npm install   # needs a GitHub token with packages:read — see below
npm run dev   # http://localhost:5174
```

### The private registry

`@companionintelligence/ui` and `@companionintelligence/tokens` are private
packages on GitHub Packages (`npm.pkg.github.com`), per `.npmrc` in this
directory. `npm install` needs `NODE_AUTH_TOKEN` set to a token with
`packages:read` for the `companionintelligence` org:

```bash
NODE_AUTH_TOKEN="$(gh auth token)" npm install
```

CI does the same with `secrets.GITHUB_TOKEN` (see `.github/workflows/deploy-er-connect.yml`
and `ci.yml`'s `ci-glasses-app` job, which consumes the same registry the
same way).

## Build

```bash
npm run build   # tsc -b && vite build → dist/, then scripts/check-dist.mjs
npm run check:dist   # re-run just the output checks against an existing dist/
```

`scripts/check-dist.mjs` runs at the end of every build and fails it when the
output regresses: the ci.computer / Buy / Download / docs cross-links must be
real `<a href>` elements (in the static shell, the 404 page and the app; the 404
carries the same Buy / Download callouts, labels and button classes as the
hero), no links to the private GitHub repo, no Google Fonts, exactly one
canonical / OG image / JSON-LD block, GA4 emitted exactly once per page when the
build had a valid ID (and not at all when it did not), the emitted GA init
never sending the OAuth `code` / `state` to Google, the strict CSP and HSTS
intact, and the JS stays under a size budget. CI (`ci.yml`, job `er-connect`)
runs the same build.

The page works before and without JavaScript: `index.html` carries a static
copy of the header, hero, Buy/Download callouts and footer, and React replaces
it on start (keep `index.html` and `src/App.tsx` in step; the check compares the
button classes and links). Manrope is self-hosted from `@fontsource-variable/manrope`
(no Google Fonts request), the Help dialog is loaded on demand, and
`vite.config.ts` strips a dead `lucide-react` re-export out of
`@companionintelligence/icons` (it pulled ~790 KB of unused icons into the
bundle; the plugin warns if the package changes shape).

`dist/` is what actually gets deployed — `wrangler.jsonc`'s
`assets.directory` points at it. `public/_headers` (security headers, CSP)
is copied into `dist/` verbatim by Vite on every build; never edit
`dist/_headers` directly.

## Deploy

**Live** at <https://er.ci.computer>, deployed as a **Cloudflare Worker with
static assets** — not a classic Cloudflare Pages project, and that wasn't a
choice, it's what `wrangler` (4.143.0, as of this writing) does by default
now. `wrangler pages project create ci-er-connect` produced a Worker (with
`assets.directory` set) rather than an entry in `wrangler pages project
list`; the CLI itself says so — "Workers are the recommended way to deploy
all new projects" — and even offers a `--force` flag to opt back into a
classic Pages project, which we did not use. `wrangler pages deploy` does
not work against it (`The Pages project "ci-er-connect" does not exist`) —
everything below uses plain `wrangler deploy`, which reads the Worker name,
the `dist/` assets directory, and the `er.ci.computer` custom-domain route
straight from `wrangler.jsonc`, rather than from CLI flags.

Worth knowing: the rest of `ci.computer`'s sites (`ci-virtual-home`,
`time-machine`, `ci-os-hub-docs`, `ci-pebble`, `avatars`,
`ci-public-website`, `spellbook` — checked via `wrangler pages project
list` against this same account) are all still classic Pages projects on
`*.pages.dev` with dashboard-managed custom domains. This site is the
current outlier, forced by what the CLI does today rather than chosen for
consistency with its siblings.

### Redeploy

```bash
cd er-connect
npm run build
npx wrangler deploy
```

Needs a Cloudflare account with access to `ci.computer` — run `npx wrangler
login` first if not already authenticated (opens a browser tab once). Use
wrangler 4: the assets-only `wrangler.jsonc` has no `main`, which wrangler 3.x
rejects with "Missing entry-point". Build with `GA_MEASUREMENT_ID` set (the
repo variable's value) or the live page ships without analytics.

After any deploy, check that it is actually live, not just green:

```bash
curl -s https://er.ci.computer/ | grep -c 'href="https://ci.computer/core"'   # 1 or more
curl -sI https://er.ci.computer/robots.txt | head -1                         # HTTP/2 200
```

### Or via GitHub Actions

[`deploy-er-connect.yml`](../.github/workflows/deploy-er-connect.yml) installs,
builds, and runs the same `wrangler deploy` from CI, manually triggered:

```bash
gh workflow run deploy-er-connect.yml --repo companionintelligence/CI-Even-Realities --ref main
```

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as repo secrets
(Settings → Secrets and variables → Actions): the token from My Profile →
API Tokens → **Create Token** → "Edit Cloudflare Workers" template, scoped
to the account that owns `ci.computer`; the account ID from the dashboard
sidebar under Workers & Pages → Overview. `NODE_AUTH_TOKEN` for the private
registry install comes from the workflow's own `secrets.GITHUB_TOKEN` — no
extra secret needed for that part. The workflow pins `wranglerVersion: '4'`,
fails fast with a clear message when the two secrets are missing, and ends by
fetching the live site to prove the new build is served.

### Give a future Claude session Cloudflare access instead

This Claude Code org has a **"Cloudflare Developer Platform"** connector
available. Connecting it at
[claude.ai/customize/connectors](https://claude.ai/customize/connectors) and
starting a new session would let Claude run `npm run build && wrangler
deploy` (or call the API directly) without a human in the loop for future
redeploys.

## OIDC client (registered)

`src/auth/oidc.ts` uses `client_id: 'ci-er-connect'`. It is registered in CI-Portal
(`oidcClients.ts` → `PUBLIC_CLIENTS`, name "CI Companion — Setup & Connect") and
is deployed to staging and production. Because this client has exactly one
redirect, CI-Portal pins it in `FIXED_PUBLIC_REDIRECTS`
(`firstPartyRedirect.ts`): the only accepted `redirect_uri` is
**`https://er.ci.computer/`** — trailing slash included. Consent is still shown
on first sign-in. If you ever serve er-connect from another origin (a preview
URL, a new domain), sign-in there will be rejected until CI-Portal's list is
extended; that is deliberate.

## Test sign-in end to end

Run this after every er-connect deploy, and after any CI-Portal promotion that
touches auth. It takes about two minutes and needs a CI-Portal account. Use a
normal browser window (not a private window if you want step 7 to work).

1. **Open <https://er.ci.computer>.** You should see the CI Companion header and
   a three-step Stepper (Install → Connect → Talk). Open **Help** (top right):
   the tabbed dialog should open and close cleanly.
2. **Go to step 2, Connect.** Under *Sign in* you should see the button
   **Sign in with Companion Intelligence** and no red error text.
3. **Click it.** The browser leaves er.ci.computer for
   `https://hub.ci.computer/…` and lands on the CI-Portal **login** page. The
   address bar should carry `client_id=ci-er-connect` and
   `redirect_uri=https://er.ci.computer/`.
4. **Log in**, then approve the **consent** screen (first time only). You are
   sent back to `https://er.ci.computer/?code=…&state=…`; the page exchanges the
   code and strips the query string from the address bar.
5. **Check the result.** A green pill with your name (or "Signed in") appears
   beside the *Sign in* label, and the button becomes **Sign out**. In DevTools → Application →
   Session Storage → `https://er.ci.computer` there is an
   `er-connect:oidc-tokens` entry (session, not local, storage on purpose). If the
   token request fails with a CORS error, CI-Portal's allowed origins do not
   include `https://er.ci.computer` yet; that is a CI-Portal change, not this repo.
6. **Enter your Hub host** (for example `ci-hub.local` or `192.168.1.50`) and
   click **Connect**. Expect a **Saved http://<host>:8787 — not verified** pill
   with a note under it (*Browsers can't test a plain-http host from this page*),
   *not* a green "Connected" and not a red "Unreachable". This is expected: an agent-hub is plain `http://<host>:8787`
   and browsers refuse plain-http requests from an https page (mixed content),
   so er.ci.computer cannot check it. A hub served over `https://` gets a real
   green/red result. The host is remembered either way.
7. **Reload the page.** You should stay signed in (same tab) and, with a remembered host,
   see the same Connect result again with no clicks — that is the auto-reconnect.
   Click **Sign out** and reload: back to the **Sign in with Companion Intelligence** button.
   Closing the tab also signs out; the Hub address is still remembered.

Then finish on the phone: open **CI Companion** in the Even app → Settings →
CI-Hub, enter the same host, and tap a **Quick connect** preset. That is where
the connection is actually verified end to end.

### If it fails

| You see | Meaning / fix |
|---|---|
| Error text under the sign-in button, or a Portal page saying invalid client / invalid redirect | The client or redirect isn't registered on the Portal environment you hit. Check `PUBLIC_CLIENTS` and `FIXED_PUBLIC_REDIRECTS` in CI-Portal, and that the page is served from exactly `https://er.ci.computer/`. **Reaching the login page proves nothing** — an unauthenticated `/oauth2/authorize` redirects to `/login` for *any* client id or redirect (checked 2026-09-28 with a made-up client), so registration errors only appear after you log in. |
| Bounced back to er.ci.computer but still signed out, with an error | The code exchange failed. Open DevTools → Network and look at the `…/oauth2/token` request: `invalid_grant` usually means the tab was reloaded mid-flow (the PKCE verifier is per-tab, in `sessionStorage`) — just start again. |
| Signed out on every reload | Storage is blocked or the window is private. `sessionStorage` (sign-in) and `localStorage` (Hub address) must be writable for `https://er.ci.computer`. The page still works with storage blocked; it just remembers nothing, and sign-in says why it cannot continue. |
| "Couldn't reach the Companion Intelligence sign-in service" | The token request was blocked or offline. If it happens on a good connection, check the browser console for a CORS error (see step 5). |
| Red "Unreachable" on an `https://` hub | A real network failure — the host, port 8787, DNS, or a certificate. Test `curl -I https://<host>:8787` from the same machine. |

## Files

- `src/App.tsx` — page layout: header, hero and Buy/Download callouts, the Install/Connect/Talk `Stepper`, footer, lazily loaded `HelpDialog`.
- `src/links.ts` — every outbound URL and the shared Buy/Download labels, in one place (read by `scripts/check-dist.mjs`).
- `src/lib/storage.ts` — Web Storage wrappers that never throw; `src/components/ErrorBoundary.tsx` keeps one render error from blanking the page.
- `src/components/HelpDialog.tsx` — the tabbed help modal (how it works, screenshots, manual config, backends, troubleshooting).
- `index.html` / `404.html` — static first-paint shell and the branded 404 (both Vite entries, so they share the app's CSS, tokens and font).
- `scripts/check-dist.mjs` — build-time assertions on `dist/`.
- `src/auth/` — `pkce.ts` (RFC 7636 helpers), `oidc.ts` (the CI-Portal Authorization Code + PKCE flow, mirrors `ci-glasses-app/src/auth/OidcClient.ts`), `useConnect.ts` (the React hook wiring sign-in + Hub-connect lifecycle together, including auto-reconnect on boot).
- `src/hub/connect.ts` — CI-Hub host normalization and the `agent-hub` reachability probe, mirrors `ci-glasses-app/src/config/HubPresets.ts`.
- `public/` — icons and OG image (from the CI-Common mark), `site.webmanifest`, `robots.txt`, `sitemap.xml`, screenshots (WebP, ~600 px wide, resized from `ci-glasses-app/assets/screenshots/01-empty-quick-actions.png` and `03-settings.png` — refresh them whenever the app's look changes), and `_headers` — copied into `dist/` verbatim on build. Hashed build output goes to `/static/` (cached immutable); `/assets/` is for unhashed images.
- `wrangler.jsonc` — the Worker config: name (`ci-er-connect`), `dist/` as the assets directory, and the `er.ci.computer` custom-domain route.

## Analytics (GA4)

Google Analytics 4 is injected at build time by `vite.config.ts` when `GA_MEASUREMENT_ID` matches `/^G-[A-Z0-9]+$/`; otherwise nothing is emitted. The deploy workflow sources it from the repo variable of the same name:

```bash
gh variable set GA_MEASUREMENT_ID --body G-XXXX --repo companionintelligence/CI-Even-Realities
```

The ID is never committed. The init script is an external `ga-init.js` so the CSP in `public/_headers` needs no `unsafe-inline`. If Google's script is blocked or offline the page is unaffected. The footer discloses analytics (and links Privacy) only when the build has a valid ID, and tags are injected into the freshly built HTML on every build, so rebuilding never duplicates them.

The ID can come from the environment (CI, the deploy workflow) or from a Vite env file such as `er-connect/.env.local` (gitignored); an environment value wins. `scripts/check-dist.mjs` treats the built `dist/` as the source of truth for whether GA was configured, so a local build with `.env.local` passes, and when `GA_MEASUREMENT_ID` is set in the environment it also checks the output matches it.

**OAuth return trip.** After sign-in the browser lands on `/?code=…&state=…`. `ga-init.js` runs before the app mounts, and `gtag('config')` would otherwise read that full URL as `page_location`, so the config call passes its own `page_location` with `code`, `state`, `error`, `error_description` and `iss` removed (other parameters such as `utm_*` are kept for campaign attribution). The app still scrubs the address bar after it mounts; the init file closes the window before that. `check-dist` executes the emitted file against callback URLs and fails the build if any of those parameters would reach Google.

Cloudflare's dashboard can also auto-inject Web Analytics and bot-detection scripts on this hostname; the strict CSP blocks them and logs two console errors. Turn those off for `er.ci.computer` in the dashboard (Web Analytics, and Security → Bots → JavaScript Detections) instead of loosening the CSP.
