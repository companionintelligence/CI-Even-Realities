import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Google Analytics 4. The measurement ID is a build-time value
// (GA_MEASUREMENT_ID, set from the repo variable in the deploy workflow) and is
// never committed. Nothing is emitted unless it looks like a real G-… ID.
//
// The gtag init lives in an emitted external file (not an inline <script>) so
// the CSP in public/_headers can stay free of 'unsafe-inline'. If
// googletagmanager.com is blocked or offline (e.g. in the Even Realities
// companion webview) the app is unaffected — the init only pushes to
// window.dataLayer and the loader is async.
//
// Idempotent: tags are injected into the freshly transformed HTML on every
// build (index.html itself never contains them), so a rebuild cannot duplicate them.
function ga4(id: string): Plugin {
  const initFile = 'ga-init.js';
  return {
    name: 'er-connect:ga4',
    apply: 'build',
    transformIndexHtml() {
      if (!isGaId(id)) return;
      return [
        {
          tag: 'script',
          attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
          injectTo: 'head',
        },
        { tag: 'script', attrs: { src: `/${initFile}` }, injectTo: 'head' },
      ];
    },
    generateBundle() {
      if (!isGaId(id)) return;
      this.emitFile({
        type: 'asset',
        fileName: initFile,
        source:
          `window.dataLayer=window.dataLayer||[];` +
          `function gtag(){dataLayer.push(arguments);}` +
          `gtag('js',new Date());gtag('config','${id}');\n`,
      });
    },
  };
}

// @companionintelligence/icons is published with `export * from 'lucide-react'`, which
// tsup compiles to a top-level `__reExport(icons_exports, lucide_react_star)` call.
// That call has side effects, so Rollup cannot tree-shake it: importing the CI
// <Logo> through @companionintelligence/ui drags the ENTIRE lucide-react library
// (~790 KB of the ~1.2 MB bundle) into the page. This page only ever uses Logo
// (the ui kit imports its own handful of lucide icons by name, which stay), so drop
// that one statement. If the package is ever republished without it this does
// nothing, and scripts/check-dist.mjs's bundle-size budget will say so either way.
function slimIconsPackage(): Plugin {
  const statement = /^__reExport\(icons_exports, lucide_react_star\);$/m;
  return {
    name: 'er-connect:slim-icons',
    enforce: 'pre',
    transform(code, id) {
      if (!/@companionintelligence\/icons\/dist\/index\.js$/.test(id)) return;
      if (!statement.test(code)) {
        this.warn(`slim-icons: the lucide-react re-export statement was not found in ${id}. If the package changed, review this plugin; the bundle may be larger than needed.`);
        return;
      }
      return { code: code.replace(statement, '/* __reExport(icons_exports, lucide_react_star) removed: see vite.config.ts */'), map: null };
    },
  };
}

function isGaId(id: string): boolean {
  return /^G-[A-Z0-9]+$/.test(id);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const gaId = env.GA_MEASUREMENT_ID ?? '';
  return {
    // Served from the root of er.ci.computer. Absolute asset URLs also keep the
    // 404 page working when it is served at an arbitrary depth (/a/b/c).
    base: '/',
    plugins: [slimIconsPackage(), react(), tailwindcss(), ga4(gaId)],
    define: {
      __GA_ENABLED__: JSON.stringify(isGaId(gaId)),
    },
    build: {
      outDir: 'dist',
      target: 'es2020',
      // Hashed bundle output lives under /static/ so public/_headers can mark it
      // immutable with one rule; /assets/ holds the unhashed brand images.
      assetsDir: 'static',
      rollupOptions: {
        output: {
          // React in its own chunk: it changes far less often than the app, so a
          // returning visitor keeps it cached (immutable) across deploys.
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          },
        },
        // 404.html is its own entry so it shares the app's tokens, font and CSS
        // instead of carrying a hand-copied palette.
        input: {
          main: 'index.html',
          notFound: '404.html',
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
    },
  };
});
