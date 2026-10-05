#!/usr/bin/env node
/**
 * Build-time checks for er-connect/dist. Runs at the end of `npm run build`, so a
 * deploy that would ship a broken page fails before it gets anywhere near
 * Cloudflare. Also runnable on its own: `npm run check:dist`.
 *
 * What it guards (each one has regressed, or was found missing, before):
 *   - the cross-links to ci.computer (home, BUY /core, DOWNLOAD /download) and the
 *     matching docs page exist as real <a href> elements in the static HTML, in the
 *     404 page and in the JS bundle, and open in the same tab
 *   - no links to the private GitHub repo, no Google Fonts, no legacy Even Hub host
 *   - SEO and metadata: one title / canonical / og:image, valid JSON-LD, robots.txt,
 *     sitemap.xml, web manifest, 1200x630 OG image, icons
 *   - GA4 is emitted exactly once when GA_MEASUREMENT_ID is a valid G-… ID, and not
 *     at all when it is not (idempotent: rebuilding never duplicates tags)
 *   - the static first-paint shell uses the same button classes as the kit
 *   - the CSP stays strict and bundle output stays under a size budget
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const failures = [];
const fail = (message) => failures.push(message);
const check = (condition, message) => {
  if (!condition) fail(message);
};

function read(path) {
  return readFileSync(path, 'utf8');
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

if (!existsSync(dist)) {
  console.error('check-dist: dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

// --- constants from src/links.ts (single source of truth for every URL) -------------
const linksSource = read(join(root, 'src/links.ts'));
const links = Object.fromEntries(
  [...linksSource.matchAll(/^export const (\w+) = '([^']+)';$/gm)].map((m) => [m[1], m[2]]),
);
for (const key of ['CI_SITE_URL', 'BUY_URL', 'DOWNLOAD_URL', 'DOCS_URL', 'SUPPORT_URL', 'PRIVACY_URL', 'TERMS_URL', 'BUY_LABEL', 'DOWNLOAD_LABEL']) {
  check(links[key], `src/links.ts: missing export ${key}`);
}
check(links.BUY_URL === 'https://ci.computer/core', `BUY_URL must be exactly https://ci.computer/core (got ${links.BUY_URL})`);
check(links.DOWNLOAD_URL === 'https://ci.computer/download', `DOWNLOAD_URL must be exactly https://ci.computer/download (got ${links.DOWNLOAD_URL})`);
check(links.CI_SITE_URL === 'https://ci.computer', `CI_SITE_URL must be https://ci.computer (got ${links.CI_SITE_URL})`);

// --- the files that must ship --------------------------------------------------------
const required = [
  'index.html',
  '404.html',
  '_headers',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
  'favicon.ico',
  'assets/favicon.svg',
  'assets/favicon-32.png',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/og-image.png',
  'assets/screenshot-chat.webp',
  'assets/screenshot-settings.webp',
];
for (const file of required) check(existsSync(join(dist, file)), `dist/${file} is missing`);
if (failures.length) finish();

const indexHtml = read(join(dist, 'index.html'));
const notFoundHtml = read(join(dist, '404.html'));
const headers = read(join(dist, '_headers'));
const staticFiles = walk(dist).filter((f) => relative(dist, f).startsWith('static'));
const jsFiles = staticFiles.filter((f) => f.endsWith('.js'));
const jsText = jsFiles.map(read).join('\n');
const textAssets = walk(dist).filter((f) => /\.(html|js|css|json|webmanifest|xml|txt)$/.test(f) || f.endsWith('_headers'));
const allText = textAssets.map((f) => `${relative(dist, f)}\n${read(f)}`).join('\n');

// --- cross-links ---------------------------------------------------------------------
const anchorFor = (html, href) =>
  [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(`href="${href}"`));

for (const [name, html] of [
  ['index.html', indexHtml],
  ['404.html', notFoundHtml],
]) {
  const home = anchorFor(html, links.CI_SITE_URL);
  check(home.length > 0, `${name}: no <a href="${links.CI_SITE_URL}"> link back to the main site`);
}
for (const key of ['CI_SITE_URL', 'BUY_URL', 'DOWNLOAD_URL', 'DOCS_URL', 'SUPPORT_URL', 'PRIVACY_URL', 'TERMS_URL']) {
  check(anchorFor(indexHtml, links[key]).length > 0, `index.html static shell: missing <a href="${links[key]}"> (${key})`);
  check(jsText.includes(links[key]), `JS bundle: ${links[key]} (${key}) is not in the app`);
}
// BUY and DOWNLOAD must appear at least twice in the static shell: hero callout + footer.
check(anchorFor(indexHtml, links.BUY_URL).length >= 2, 'index.html: expected the BUY callout in both the hero and the footer');
check(anchorFor(indexHtml, links.DOWNLOAD_URL).length >= 2, 'index.html: expected the DOWNLOAD callout in both the hero and the footer');
check(indexHtml.includes(`>${links.BUY_LABEL}</a>`), `index.html: BUY link text must be "${links.BUY_LABEL}"`);
check(indexHtml.includes(`>${links.DOWNLOAD_LABEL}</a>`), `index.html: DOWNLOAD link text must be "${links.DOWNLOAD_LABEL}"`);
check(jsText.includes(links.BUY_LABEL) && jsText.includes(links.DOWNLOAD_LABEL), 'JS bundle: callout labels missing');
for (const [name, html] of [
  ['index.html', indexHtml],
  ['404.html', notFoundHtml],
]) {
  for (const tag of [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])) {
    const href = (tag.match(/href="([^"]+)"/) ?? [])[1] ?? '';
    if (/target="_blank"/.test(tag)) {
      check(/rel="[^"]*noopener/.test(tag), `${name}: target=_blank link without rel=noopener: ${tag}`);
      check(!href.startsWith(links.CI_SITE_URL), `${name}: ci.computer links must open in the same tab: ${tag}`);
    }
  }
}

// --- things that must NOT be in the output -------------------------------------------
check(!/github\.com\/companionintelligence/i.test(allText), 'dist links to the private companionintelligence GitHub org (404s for visitors)');
check(!/fonts\.(googleapis|gstatic)\.com/.test(allText), 'dist still references Google Fonts (self-host Manrope instead)');
check(!/evenhub\.evenrealities\.com/.test(allText), 'dist uses the legacy evenhub.evenrealities.com host (use hub.evenrealities.com)');
check(!/Sideload latest|Get on Even Hub|connected to your CI-Hub/.test(allText), 'dist still promises an Even Hub install that does not exist yet');

// --- metadata and SEO ----------------------------------------------------------------
const one = (re, label, html = indexHtml) => {
  const matches = html.match(re) ?? [];
  check(matches.length === 1, `index.html: expected exactly one ${label}, found ${matches.length}`);
  return matches[0];
};
one(/<title>[^<]+<\/title>/g, '<title>');
one(/<link rel="canonical" href="https:\/\/er\.ci\.computer\/"/g, 'canonical');
one(/<meta name="description"/g, 'meta description');
one(/<meta property="og:image" content="https:\/\/er\.ci\.computer\/assets\/og-image\.png"/g, 'og:image');
one(/<meta name="twitter:image" content="https:\/\/er\.ci\.computer\/assets\/og-image\.png"/g, 'twitter:image');
one(/<meta name="twitter:card" content="summary_large_image"/g, 'twitter:card');
one(/<link rel="manifest"/g, 'manifest link');
one(/<script type="application\/ld\+json">/g, 'JSON-LD block');
check(/<meta name="robots" content="noindex"/.test(notFoundHtml), '404.html must be noindex');
check(/<h1\b/.test(indexHtml), 'index.html: static shell must contain an <h1> for crawlers and no-JS visitors');

const jsonLd = (indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? [])[1];
try {
  const doc = JSON.parse(jsonLd);
  const graph = doc['@graph'] ?? [];
  const org = graph.find((n) => n['@type'] === 'Organization');
  check(org && org.logo && Array.isArray(org.sameAs) && org.sameAs.length > 0, 'JSON-LD: Organization needs a logo and sameAs');
  check(graph.some((n) => n['@type'] === 'WebPage'), 'JSON-LD: expected a WebPage node');
  check(!graph.some((n) => n['@type'] === 'SoftwareApplication'), 'JSON-LD: do not declare a SoftwareApplication until there is a public listing');
} catch (error) {
  fail(`JSON-LD does not parse: ${error.message}`);
}

const robots = read(join(dist, 'robots.txt'));
check(/Sitemap:\s*https:\/\/er\.ci\.computer\/sitemap\.xml/.test(robots), 'robots.txt: Sitemap line missing');
const sitemap = read(join(dist, 'sitemap.xml'));
check(sitemap.includes('<loc>https://er.ci.computer/</loc>'), 'sitemap.xml: the home URL is missing');

try {
  const manifest = JSON.parse(read(join(dist, 'site.webmanifest')));
  check(manifest.name && manifest.icons?.length >= 2, 'site.webmanifest: needs a name and icons');
  for (const icon of manifest.icons ?? []) check(existsSync(join(dist, icon.src)), `site.webmanifest: icon ${icon.src} does not exist`);
} catch (error) {
  fail(`site.webmanifest does not parse: ${error.message}`);
}

const png = readFileSync(join(dist, 'assets/og-image.png'));
const ogW = png.readUInt32BE(16);
const ogH = png.readUInt32BE(20);
check(ogW === 1200 && ogH === 630, `assets/og-image.png must be 1200x630 (is ${ogW}x${ogH})`);

// --- every root-relative reference resolves to a file --------------------------------
for (const [name, html] of [
  ['index.html', indexHtml],
  ['404.html', notFoundHtml],
]) {
  for (const m of html.matchAll(/\b(?:href|src)="(\/[^"#?]*)/g)) {
    const path = m[1];
    if (path === '/') continue;
    check(existsSync(join(dist, path)), `${name}: ${path} does not exist in dist`);
  }
}
for (const m of jsText.matchAll(/["'`](\/assets\/[\w.-]+\.(?:png|webp|svg))["'`]/g)) {
  check(existsSync(join(dist, m[1])), `JS bundle: ${m[1]} does not exist in dist`);
}

// --- GA4: exactly once when configured, not at all when not --------------------------
const gaId = process.env.GA_MEASUREMENT_ID ?? '';
const gaValid = /^G-[A-Z0-9]+$/.test(gaId);
for (const [name, html] of [
  ['index.html', indexHtml],
  ['404.html', notFoundHtml],
]) {
  const loaders = count(html, 'googletagmanager.com/gtag/js');
  const inits = count(html, 'src="/ga-init.js"');
  if (gaValid) {
    check(loaders === 1, `${name}: expected exactly one gtag loader, found ${loaders}`);
    check(inits === 1, `${name}: expected exactly one ga-init.js tag, found ${inits}`);
    check(html.includes(`gtag/js?id=${gaId}`), `${name}: gtag loader does not use GA_MEASUREMENT_ID`);
  } else {
    check(loaders === 0 && inits === 0, `${name}: GA tags emitted without a valid GA_MEASUREMENT_ID`);
  }
}
if (gaValid) {
  check(existsSync(join(dist, 'ga-init.js')), 'ga-init.js was not emitted');
  check(count(read(join(dist, 'ga-init.js')), `gtag('config','${gaId}')`) === 1, 'ga-init.js: expected one gtag config call');
} else {
  check(!existsSync(join(dist, 'ga-init.js')), 'ga-init.js emitted without a valid GA_MEASUREMENT_ID');
}

// --- headers / CSP -------------------------------------------------------------------
const csp = (headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m) ?? [])[1] ?? '';
check(csp.length > 0, '_headers: no Content-Security-Policy');
const directive = (name) => (csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`)) ?? [])[1] ?? '';
const scriptSrc = directive('script-src');
check(scriptSrc.length > 0, "_headers: CSP has no script-src");
check(!/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc), "_headers: script-src must not allow 'unsafe-inline' or 'unsafe-eval'");
check(/https:\/\/www\.googletagmanager\.com/.test(scriptSrc), '_headers: script-src must allow googletagmanager (GA4)');
check(/https:\/\/www\.google-analytics\.com/.test(directive('img-src')), '_headers: img-src must allow google-analytics (GA4 beacons)');
check(/frame-ancestors 'none'/.test(csp) && /base-uri 'none'/.test(csp), "_headers: CSP must keep frame-ancestors 'none' and base-uri 'none'");
check(/^\s*Strict-Transport-Security:\s*max-age=\d{7,}/m.test(headers), '_headers: Strict-Transport-Security missing');
check(/\/static\/\*\s*\n\s*Cache-Control:[^\n]*immutable/.test(headers), '_headers: /static/* must be cached as immutable');

// --- bundle budget -------------------------------------------------------------------
// The CI icons package re-exports all of lucide-react unless vite.config.ts strips that
// statement; without it the JS is ~1.2 MB. Keep a hard budget so a regression is loud.
const jsBytes = jsFiles.reduce((sum, f) => sum + statSync(f).size, 0);
const budget = 650 * 1024;
check(jsBytes <= budget, `JS bundle is ${(jsBytes / 1024).toFixed(0)} KB, over the ${(budget / 1024).toFixed(0)} KB budget (see slimIconsPackage in vite.config.ts)`);
for (const file of staticFiles.filter((f) => f.endsWith('.woff2'))) {
  check(statSync(file).size < 60 * 1024, `${relative(dist, file)} is larger than expected for a Latin subset`);
}
const assetBytes = (name) => statSync(join(dist, 'assets', name)).size;
for (const name of ['screenshot-chat.webp', 'screenshot-settings.webp']) {
  check(assetBytes(name) < 100 * 1024, `assets/${name} should stay under 100 KB`);
}

// --- static shell uses the kit's own button classes ----------------------------------
try {
  const { buttonVariants } = await import('@companionintelligence/ui');
  const expected = {
    'hero BUY (default)': buttonVariants({ variant: 'default' }),
    'hero DOWNLOAD (outline)': buttonVariants({ variant: 'outline' }),
    'header Docs (ghost sm)': buttonVariants({ variant: 'ghost', size: 'sm' }),
  };
  for (const [label, classes] of Object.entries(expected)) {
    check(indexHtml.includes(`class="${classes}"`), `index.html static shell: ${label} classes drifted from the kit's buttonVariants`);
  }
} catch (error) {
  fail(`could not load @companionintelligence/ui to compare button classes: ${error.message}`);
}

finish();

function finish() {
  if (failures.length) {
    console.error(`\ncheck-dist: ${failures.length} problem(s)\n`);
    for (const message of failures) console.error(`  x ${message}`);
    console.error('');
    process.exit(1);
  }
  console.log(`check-dist: ok (${jsFiles.length} JS files, ${(jsFiles.reduce((s, f) => s + statSync(f).size, 0) / 1024).toFixed(0)} KB; GA4 ${gaValid ? 'enabled' : 'off'})`);
}
