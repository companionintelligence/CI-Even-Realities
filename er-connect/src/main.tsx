import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@companionintelligence/ui';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BUY_LABEL, BUY_URL, CI_SITE_URL, DOCS_URL, DOWNLOAD_LABEL, DOWNLOAD_URL } from './links';
import './index.css';

// Plain markup on purpose: if the app itself failed to render, this must not
// depend on the component kit that may have just thrown.
const crashFallback = (
  <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 text-center">
    <h1 className="text-xl font-extrabold tracking-tight">CI Companion couldn&apos;t start</h1>
    <p className="mt-2 text-sm text-muted-foreground">
      Something went wrong loading this page. Reload to try again, or use the docs.
    </p>
    <p className="mt-4 text-sm">
      <a className="underline underline-offset-4" href={DOCS_URL}>
        Docs
      </a>
      {' · '}
      <a className="underline underline-offset-4" href={CI_SITE_URL}>
        Companion Intelligence
      </a>
      {' · '}
      <a className="underline underline-offset-4" href={BUY_URL}>
        {BUY_LABEL}
      </a>
      {' · '}
      <a className="underline underline-offset-4" href={DOWNLOAD_URL}>
        {DOWNLOAD_LABEL}
      </a>
    </p>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={crashFallback}>
      <ThemeProvider defaultTheme="dark" storageKey="er-connect-theme">
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
