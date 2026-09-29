import { useCallback, useEffect, useState } from 'react';
import {
  beginSignIn,
  completeSignInFromCallback,
  identityFromTokens,
  isCallback,
  loadTokens,
  refreshTokens,
  signOut as oidcSignOut,
  type Identity,
  type TokenSet,
} from './oidc';
import { HUB_URL_KEY, probeHub } from '../hub/connect';

/** `unverified` = saved, but this browser can't test the host from an https page. */
export type ConnectStatus = 'idle' | 'checking' | 'ok' | 'unverified' | 'error';

export interface ConnectState {
  booting: boolean;
  identity: Identity | null;
  signinError: string | null;
  signinBusy: boolean;
  signIn: () => void;
  signOut: () => void;
  hubUrl: string;
  setHubUrl: (value: string) => void;
  connectStatus: ConnectStatus;
  connectMessage: string | null;
  runConnect: () => void;
}

/** Owns the sign-in + Hub-connect lifecycle: boot, callback exchange, refresh, auto-connect. */
export function useConnect(): ConnectState {
  const [booting, setBooting] = useState(true);
  const [tokens, setTokens] = useState<TokenSet | null>(null);
  const [signinError, setSigninError] = useState<string | null>(null);
  const [signinBusy, setSigninBusy] = useState(false);
  const [hubUrl, setHubUrlState] = useState(() => localStorage.getItem(HUB_URL_KEY) ?? '');
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle');
  const [connectMessage, setConnectMessage] = useState<string | null>(null);

  const runConnect = useCallback(() => {
    const raw = hubUrl.trim();
    if (!raw) {
      setConnectStatus('error');
      setConnectMessage('Enter a Hub host first');
      return;
    }
    localStorage.setItem(HUB_URL_KEY, raw);
    setConnectStatus('checking');
    setConnectMessage('Connecting…');
    probeHub(raw).then((result) => {
      if (result.blocked) {
        setConnectStatus('unverified');
        // Short on purpose: it renders in a single-line StatusPill. The explanation lives in App.tsx.
        setConnectMessage(`Saved ${result.url} — not verified`);
        return;
      }
      setConnectStatus(result.ok ? 'ok' : 'error');
      setConnectMessage(result.ok ? `Connected: ${result.url}` : `Unreachable: ${result.url}`);
    });
  }, [hubUrl]);

  const setHubUrl = useCallback((value: string) => {
    setHubUrlState(value);
    setConnectStatus('idle');
    setConnectMessage(null);
  }, []);

  const signIn = useCallback(() => {
    setSigninBusy(true);
    setSigninError(null);
    beginSignIn().catch((err: Error) => {
      setSigninError(err.message);
      setSigninBusy(false);
    });
  }, []);

  const signOut = useCallback(() => {
    oidcSignOut(tokens);
    setTokens(null);
  }, [tokens]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let next: TokenSet | null = null;

      if (isCallback()) {
        try {
          next = await completeSignInFromCallback();
        } catch (err) {
          if (!cancelled) {
            setSigninError((err as Error).message);
            setBooting(false);
          }
          return;
        }
      } else {
        next = loadTokens();
        if (next && Date.now() > next.expiresAt - 60_000) {
          if (next.refreshToken) {
            try {
              next = await refreshTokens(next.refreshToken);
            } catch {
              next = null;
            }
          } else {
            next = null;
          }
        }
      }

      if (cancelled) return;
      setTokens(next);
      setBooting(false);

      // Auto setup: once signed in with a remembered Hub host, reconnect
      // immediately — no clicks needed.
      if (next && hubUrl.trim()) runConnect();
    }

    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    booting,
    identity: identityFromTokens(tokens),
    signinError,
    signinBusy,
    signIn,
    signOut,
    hubUrl,
    setHubUrl,
    connectStatus,
    connectMessage,
    runConnect,
  };
}
