/**
 * Every outbound link on the page lives here, so the header, callouts, Help
 * dialog and footer cannot drift apart. `scripts/check-dist.mjs` reads this
 * file and asserts each URL is present in the built output.
 *
 * Product facts (names, one-line descriptions) are reused from ci.computer
 * itself; do not add prices, specs or availability claims here.
 */

/** Main site. Same-tab navigation, no target=_blank. */
export const CI_SITE_URL = 'https://ci.computer';

/** BUY: Companion Core. Redirects to /store/p/core; keep the /core URL as published. */
export const BUY_URL = 'https://ci.computer/core';

/** DOWNLOAD: Companion Hub. */
export const DOWNLOAD_URL = 'https://ci.computer/download';

export const SUPPORT_URL = 'https://ci.computer/support';
export const PRIVACY_URL = 'https://ci.computer/privacy-policy';
export const TERMS_URL = 'https://ci.computer/terms-of-service';

/** Redirects to the Companion Intelligence Discord invite. */
export const DISCORD_URL = 'https://ci.computer/gg';

/** The matching page in the docs. */
export const DOCS_URL = 'https://docs.ci.computer/docs/apps-available/first-party-apps/even-realities';
export const DOCS_INSTALL_URL = 'https://docs.ci.computer/docs/apps-available/first-party-apps/even-realities#install-the-app';
export const DOCS_TROUBLESHOOTING_URL = 'https://docs.ci.computer/docs/apps-available/first-party-apps/even-realities#troubleshooting';

/** Visible labels. Kept identical across the CI first-party app sites. */
export const BUY_LABEL = 'Buy Companion Core';
export const DOWNLOAD_LABEL = 'Download Companion';
