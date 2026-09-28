import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@companionintelligence/ui';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="er-connect-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
