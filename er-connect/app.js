/**
 * app.js — er-connect
 *
 * Two independent pieces sharing this one file (moved out of an inline
 * <script> so it runs under the page's CSP, which only allows script-src
 * 'self' + the Mermaid CDN — no 'unsafe-inline'):
 *
 * 1. Page chrome: Mermaid render, copy-to-clipboard buttons, and the Quick
 *    Connect config generator (mirrors ci-glasses-app/src/config/HubPresets.ts).
 * 2. Sign in with Companion Intelligence: Authorization Code + PKCE against
 *    CI-Portal, mirroring ci-glasses-app/src/auth/OidcClient.ts. Once signed
 *    in, the Hub host you enter below is remembered (localStorage) and the
 *    reachability check re-runs automatically on your next visit.
 *
 * NOTE: CLIENT_ID must be pre-registered in CI-Portal's PUBLIC_CLIENTS with
 * redirect_uri equal to this page's own URL (origin + pathname, no
 * query/hash) — sign-in will fail at the authorize step until that
 * registration exists. See README.md.
 */
(function () {
  'use strict';

  // ---- shared: Hub host / agent-hub presets (mirrors HubPresets.ts) -------

  var HUB_PORT = 8787;
  var PRESETS = [
    { label: 'Assistant', kind: 'auto', model: 'ci-companion' },
    { label: 'Ollama', kind: 'local-llm', model: 'llama3.2' },
    { label: 'Hermes', kind: 'hermes', model: 'hermes-agent' },
    { label: 'OpenClaw', kind: 'openclaw', model: 'openclaw/default' },
    { label: 'Memory', kind: 'memory', model: 'ci-memory' },
  ];

  function hubHost(raw) {
    var trimmed = (raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'http://localhost';
    var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;
    try {
      var u = new URL(withScheme);
      return u.protocol + '//' + u.hostname;
    } catch (e) {
      return 'http://localhost';
    }
  }

  function agentHubUrl(raw) {
    return hubHost(raw) + ':' + HUB_PORT;
  }

  // ---- page chrome: mermaid, copy buttons, quick-connect cards -------------

  (function renderMermaid() {
    var pre = document.querySelector('.diagram pre.mermaid');
    var fallback = document.querySelector('.diagram-fallback');
    if (!pre) return;
    if (typeof window.mermaid === 'undefined') {
      pre.style.display = 'none';
      if (fallback) fallback.style.display = 'block';
      return;
    }
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#060606',
          primaryColor: '#111111',
          primaryTextColor: '#f0f0f0',
          primaryBorderColor: '#c5e8dc',
          lineColor: '#5c8f94',
          secondaryColor: '#181818',
          tertiaryColor: '#1f1f1f',
          clusterBkg: '#181818',
          clusterBorder: '#353535',
          fontFamily:
            'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
      });
      window.mermaid.run({ querySelector: '.mermaid' }).catch(function () {
        pre.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
      });
    } catch (e) {
      pre.style.display = 'none';
      if (fallback) fallback.style.display = 'block';
    }
  })();

  function wireCopyButtons(root) {
    root.querySelectorAll('.copy-btn:not([data-wired])').forEach(function (btn) {
      btn.setAttribute('data-wired', '1');
      btn.addEventListener('click', function () {
        var value = btn.getAttribute('data-copy') || '';
        var done = function () {
          var original = btn.textContent;
          btn.textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = original;
            btn.classList.remove('copied');
          }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () {});
        }
      });
    });
  }
  wireCopyButtons(document);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function qcRow(label, value) {
    var safe = escapeHtml(value);
    return (
      '<div class="qc-row"><span class="qc-field-label">' + label + '</span>' +
      '<span class="qc-field-value"><code title="' + safe + '">' + safe + '</code>' +
      '<button class="copy-btn" data-copy="' + safe + '">Copy</button></span></div>'
    );
  }

  function renderQuickConnect() {
    var input = document.getElementById('hub-host');
    var out = document.getElementById('qc-results');
    if (!input || !out) return;
    var url = agentHubUrl(input.value);
    out.innerHTML = PRESETS.map(function (p) {
      return (
        '<div class="kind-card qc-card">' +
        '<div class="kind-name">' + p.label + '</div>' +
        qcRow('Backend URL', url) +
        qcRow('Backend Kind', p.kind) +
        qcRow('Model', p.model) +
        '</div>'
      );
    }).join('');
    wireCopyButtons(out);
  }

  // ---- base64url / PKCE (mirrors auth/pkce.ts) -----------------------------

  function base64UrlEncode(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(input) {
    var padded = input.replace(/-/g, '+').replace(/_/g, '/');
    var pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return atob(padded + pad);
  }

  function randomUrlToken(bytes) {
    var buf = new Uint8Array(bytes || 32);
    crypto.getRandomValues(buf);
    return base64UrlEncode(buf);
  }

  async function s256Challenge(verifier) {
    var data = new TextEncoder().encode(verifier);
    var digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
  }

  async function createPkcePair() {
    var verifier = randomUrlToken(32);
    var challenge = await s256Challenge(verifier);
    return { verifier: verifier, challenge: challenge };
  }

  function decodeJwtClaims(jwt) {
    var parts = (jwt || '').split('.');
    if (parts.length < 2) return null;
    try {
      return JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
      return null;
    }
  }

  // ---- OIDC discovery + PKCE flow (mirrors auth/OidcClient.ts) ------------

  var ISSUER = 'https://hub.ci.computer/api/auth';
  var CLIENT_ID = 'ci-er-connect';
  var SCOPE = 'openid email profile offline_access';

  var TOKENS_KEY = 'er-connect:oidc-tokens';
  var PENDING_KEY = 'er-connect:oidc-pending';
  var HUB_URL_KEY = 'er-connect:hub-url';

  var endpointsCache = null;

  async function discover() {
    if (endpointsCache) return endpointsCache;
    var base = ISSUER.replace(/\/+$/, '');
    try {
      var res = await fetch(base + '/.well-known/openid-configuration', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        var doc = await res.json();
        if (doc.authorization_endpoint && doc.token_endpoint) {
          endpointsCache = {
            authorization_endpoint: doc.authorization_endpoint,
            token_endpoint: doc.token_endpoint,
            userinfo_endpoint: doc.userinfo_endpoint,
            revocation_endpoint: doc.revocation_endpoint,
          };
          return endpointsCache;
        }
      }
    } catch (e) {
      // fall through to conventional layout
    }
    endpointsCache = {
      authorization_endpoint: base + '/oauth2/authorize',
      token_endpoint: base + '/oauth2/token',
      userinfo_endpoint: base + '/oauth2/userinfo',
    };
    return endpointsCache;
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  async function beginSignIn() {
    var endpoints = await discover();
    var pair = await createPkcePair();
    var state = randomUrlToken(16);
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ state: state, codeVerifier: pair.verifier, redirectUri: redirectUri() })
    );

    var url = new URL(endpoints.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pair.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    location.assign(url.toString());
  }

  function isCallback() {
    var p = new URLSearchParams(location.search);
    return p.has('code') && p.has('state');
  }

  async function tokenRequest(endpoint, body) {
    var res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) {
      var text = await res.text().catch(function () { return ''; });
      throw new Error('Token endpoint ' + res.status + ': ' + text.slice(0, 200));
    }
    var json = await res.json();
    if (!json.access_token) throw new Error('Token response missing access_token');
    return {
      accessToken: json.access_token,
      tokenType: json.token_type || 'Bearer',
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      refreshToken: json.refresh_token,
      idToken: json.id_token,
    };
  }

  async function completeSignInFromCallback() {
    var p = new URLSearchParams(location.search);
    if (p.get('error')) {
      throw new Error(
        'Authorization failed: ' + p.get('error') + (p.get('error_description') ? ' — ' + p.get('error_description') : '')
      );
    }
    var code = p.get('code');
    var state = p.get('state');
    var raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) throw new Error('No pending sign-in (start sign-in on this device first)');
    var pending = JSON.parse(raw);
    if (pending.state !== state) throw new Error('State mismatch — aborting for safety');

    var endpoints = await discover();
    var tokens = await tokenRequest(
      endpoints.token_endpoint,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: pending.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: pending.codeVerifier,
      })
    );
    sessionStorage.removeItem(PENDING_KEY);
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    history.replaceState(null, '', location.pathname);
    return tokens;
  }

  async function refreshTokens(refreshToken) {
    var endpoints = await discover();
    var next = await tokenRequest(
      endpoints.token_endpoint,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID })
    );
    if (!next.refreshToken) next.refreshToken = refreshToken;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(next));
    return next;
  }

  function loadTokens() {
    var raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function signOut() {
    var tokens = loadTokens();
    localStorage.removeItem(TOKENS_KEY);
    if (tokens && tokens.accessToken) {
      discover().then(function (endpoints) {
        if (!endpoints.revocation_endpoint) return;
        fetch(endpoints.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.accessToken, client_id: CLIENT_ID }).toString(),
        }).catch(function () {});
      });
    }
  }

  function identityFromTokens(tokens) {
    var claims = tokens && tokens.idToken ? decodeJwtClaims(tokens.idToken) : null;
    if (!claims) return null;
    return { email: claims.email, name: claims.name || claims.email };
  }

  // ---- Hub reachability probe ----------------------------------------------

  async function probeHub(rawHost) {
    var url = agentHubUrl(rawHost);
    try {
      // no-cors: the response body/status is opaque, but a resolved fetch
      // means the host answered — a network-level failure (unreachable host,
      // DNS, refused connection) rejects instead.
      await fetch(url, { mode: 'no-cors' });
      return { ok: true, url: url };
    } catch (e) {
      return { ok: false, url: url };
    }
  }

  // ---- UI wiring -------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var signedOutView = document.getElementById('signin-signed-out');
    var signedInView = document.getElementById('signin-signed-in');
    var identityEl = document.getElementById('signin-identity');
    var signinStatus = document.getElementById('signin-status');
    var signinBtn = document.getElementById('signin-btn');
    var signoutBtn = document.getElementById('signout-btn');
    var hubInput = document.getElementById('hub-host');
    var connectStatus = document.getElementById('connect-status');

    function setStatus(el, text, kind) {
      if (!el) return;
      el.textContent = text;
      el.className = 'note' + (kind ? ' ' + kind : '');
      el.style.display = text ? '' : 'none';
    }

    function showSignedIn(identity) {
      signedOutView.style.display = 'none';
      signedInView.style.display = '';
      identityEl.textContent = (identity && (identity.name || identity.email)) || 'Signed in';
    }

    function showSignedOut() {
      signedOutView.style.display = '';
      signedInView.style.display = 'none';
    }

    async function runConnect(auto) {
      var raw = hubInput.value.trim();
      renderQuickConnect();
      if (!raw) {
        setStatus(connectStatus, auto ? '' : 'enter a Hub host first', 'error');
        return;
      }
      localStorage.setItem(HUB_URL_KEY, raw);
      setStatus(connectStatus, auto ? 'auto-connecting…' : 'connecting…', '');
      var result = await probeHub(raw);
      setStatus(
        connectStatus,
        result.ok ? 'connected: ' + result.url : 'unreachable: ' + result.url,
        result.ok ? 'success' : 'error'
      );
    }

    var debounceTimer;
    hubInput.addEventListener('input', function () {
      renderQuickConnect();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { runConnect(false); }, 500);
    });

    signinBtn.addEventListener('click', function () {
      signinBtn.disabled = true;
      setStatus(signinStatus, 'redirecting to CI-Portal…', '');
      beginSignIn().catch(function (err) {
        setStatus(signinStatus, 'sign-in failed: ' + err.message, 'error');
        signinBtn.disabled = false;
      });
    });

    signoutBtn.addEventListener('click', function () {
      signOut();
      showSignedOut();
      setStatus(signinStatus, '', '');
    });

    var rememberedHub = localStorage.getItem(HUB_URL_KEY);
    if (rememberedHub) hubInput.value = rememberedHub;
    renderQuickConnect();

    async function boot() {
      var tokens = null;

      if (isCallback()) {
        setStatus(signinStatus, 'completing sign-in…', '');
        try {
          tokens = await completeSignInFromCallback();
        } catch (err) {
          setStatus(signinStatus, 'sign-in failed: ' + err.message, 'error');
          return;
        }
      } else {
        tokens = loadTokens();
        if (tokens && Date.now() > tokens.expiresAt - 60000) {
          if (tokens.refreshToken) {
            try {
              tokens = await refreshTokens(tokens.refreshToken);
            } catch (e) {
              tokens = null;
              localStorage.removeItem(TOKENS_KEY);
            }
          } else {
            tokens = null;
            localStorage.removeItem(TOKENS_KEY);
          }
        }
      }

      if (!tokens) return; // stay on the sign-in view

      setStatus(signinStatus, '', '');
      showSignedIn(identityFromTokens(tokens));

      // Auto setup: once signed in, reconnect immediately using whatever Hub
      // host is remembered on this device — no extra click needed.
      if (hubInput.value.trim()) runConnect(true);
    }

    boot();
  });
})();
