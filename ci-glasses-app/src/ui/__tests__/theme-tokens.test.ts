import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Theme/token contract for the CI Companion phone WebView.
 *
 * The surface is dark-only and takes its colours from the Companion Intelligence canon
 * (@companionintelligence/tokens) instead of re-declaring them. That only works if three
 * things hold together, and each is asserted below:
 *   1. styles.css imports the canon token layer and does NOT fork any canon name;
 *   2. index.html puts class="dark" on <html> — tokens.css's `:root` is the LIGHT palette,
 *      so without it the app would render light phthalo on a dark page;
 *   3. the installed canon's dark primary is the sage #c5e8dc, not a retired value.
 * The repo-wide gate (scripts/lint-canon.mjs + style-canon-lint.yml) covers the rest.
 */
// vitest runs from the package root (ci-glasses-app/).
const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');
const html = readFileSync(resolve('index.html'), 'utf8');
// Resolve via the package root (not `new URL(..., import.meta.url)`) — under vitest's
// jsdom environment the global URL constructor re-bases relative URLs onto jsdom's
// document location, so the import.meta.url form silently resolves to an http: URL.
const tokens = JSON.parse(
  readFileSync(resolve('node_modules/@companionintelligence/tokens/src/tokens.json'), 'utf8')
);
const canonCss = readFileSync(resolve('node_modules/@companionintelligence/tokens/src/tokens.css'), 'utf8');

/** Canon semantic names this surface must consume, never declare. */
const CANON_NAMES = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'primary',
  'primary-foreground', 'secondary', 'muted', 'muted-foreground', 'accent',
  'accent-foreground', 'destructive', 'border', 'input', 'ring',
];

describe('phone WebView theme tokens', () => {
  it('imports the canon token layer', () => {
    expect(css).toMatch(/@import\s+["']@companionintelligence\/tokens\/tokens\.css["']/);
  });

  it('does not fork the canon: no local declaration of any canon semantic token', () => {
    for (const name of CANON_NAMES) {
      const declared = new RegExp(`^\\s*--${name}\\s*:`, 'm');
      expect(css, `styles.css must not re-declare --${name}`).not.toMatch(declared);
    }
  });

  it('every var(--x) it uses is defined — locally or by the vanilla canon tokens.css', () => {
    // Regression guard: an earlier pass aliased surfaces onto --ci-surface-2 / --ci-border-3,
    // which exist only in the Tailwind-flavoured globals.css. A regex on the source can't see
    // that, and the result was a UI with no cards, borders or chip outlines. Compare against
    // what the token layer we actually import defines.
    const declared = (text: string) =>
      new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
    const defined = new Set([...declared(css), ...declared(canonCss)]);
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const undefinedVars = [...used].filter((name) => !defined.has(name)).sort();
    expect(undefinedVars, 'var() references that nothing defines').toEqual([]);
  });

  it('selects the canon dark palette via class="dark" on <html>', () => {
    expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bdark\b[^"]*"/);
  });

  it('inherits the canon dark --primary (sage), not a retired value', () => {
    const dark = canonCss.match(/\.dark\s*\{[\s\S]*?--primary:\s*(#[0-9a-fA-F]{6})/);
    expect(dark, 'tokens.css has a .dark block declaring --primary as hex').not.toBeNull();
    expect(dark?.[1].toLowerCase()).toBe(tokens.dark.primary.hex.toLowerCase());
  });

  it('paints surfaces from canon --ci-* tokens, not literals', () => {
    expect(css).toMatch(/--color-bg:\s*var\(--ci-bg\)/);
    expect(css).toMatch(/--color-surface:\s*var\(--ci-card\)/);
    expect(css).toMatch(/--color-text:\s*var\(--ci-text\)/);
  });

  it('aliases the accent onto the canonical --primary token', () => {
    // The accent must not fork from canon — it references var(--primary).
    expect(css).toMatch(/--color-accent:\s*var\(--primary\)/);
  });

  it('carries no retired teal (#abd4d8 / rgb 171,212,216)', () => {
    expect(css).not.toMatch(/#abd4d8/i);
    expect(css).not.toMatch(/rgba?\(\s*171\s*,\s*212\s*,\s*216/);
  });

  it('is dark-only — no light-theme override block', () => {
    // The phone WebView ships a single dark surface; there must be no
    // `.light`/`[data-theme="light"]` selector reintroducing a second theme.
    expect(css).not.toMatch(/\.light\b/);
    expect(css).not.toMatch(/\[data-theme=["']?light/);
  });
});
