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
function ga4(id: string): Plugin {
  const valid = /^G-[A-Z0-9]+$/.test(id);
  const initFile = 'ga-init.js';
  return {
    name: 'er-connect:ga4',
    apply: 'build',
    transformIndexHtml() {
      if (!valid) return;
      return [
        {
          tag: 'script',
          attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
          injectTo: 'head',
        },
        { tag: 'script', attrs: { src: `./${initFile}` }, injectTo: 'head' },
      ];
    },
    generateBundle() {
      if (!valid) return;
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [react(), tailwindcss(), ga4(env.GA_MEASUREMENT_ID ?? '')],
    build: {
      outDir: 'dist',
      target: 'es2020',
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
    },
  };
});
