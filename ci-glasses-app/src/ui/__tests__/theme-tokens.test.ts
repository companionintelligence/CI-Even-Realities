import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Theme/token contract for the CI Companion HUD surface.
 *
 * The HUD is dark-only and must ship the Companion Intelligence canonical
 * `--primary` — the canon dark primary from @companionintelligence/tokens (sage #c5e8dc;
 * the #abd4d8 teal was retired at tokens v0.3.0 and this test used to pin it).
 * This guards the token contract that the README "Interface" gallery documents;
 * the repo-wide canon lint gate (scripts/lint-canon.mjs + style-canon-lint.yml)
 * covers the full palette in CI.
 */
// vitest runs from the package root (ci-glasses-app/).
const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');

describe('HUD theme tokens', () => {
  it('defines the canon dark --primary from @companionintelligence/tokens', () => {
    const tokens = JSON.parse(readFileSync(new URL('../../../node_modules/@companionintelligence/tokens/src/tokens.json', import.meta.url), 'utf8'));
    const m = css.match(/--primary:\s*(#[0-9a-fA-F]{6})/);
    expect(m, 'styles.css declares --primary as hex').not.toBeNull();
    expect(m![1].toLowerCase()).toBe(tokens.dark.primary.hex.toLowerCase());
  });

  it('aliases the accent onto the canonical --primary token', () => {
    // The HUD accent must not fork from canon — it references var(--primary).
    expect(css).toMatch(/--color-accent:\s*var\(--primary\)/);
  });

  it('is dark-only — no light-theme override block', () => {
    // A heads-up display ships a single dark surface; there must be no
    // `.light`/`[data-theme="light"]` selector reintroducing a second theme.
    expect(css).not.toMatch(/\.light\b/);
    expect(css).not.toMatch(/\[data-theme=["']?light/);
  });
});
