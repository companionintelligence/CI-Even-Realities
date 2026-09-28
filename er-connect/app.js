/**
 * app.js — er-connect
 *
 * Sign in with Companion Intelligence (CI-Portal OIDC, Authorization Code +
 * PKCE), then auto-connect to the Hub URL remembered on this device. Mirrors
 * ci-glasses-app/src/auth/OidcClient.ts and config/HubPresets.ts so this
 * lander behaves the same way the app does — see that source for the
 * canonical implementation.
 *
 * NOTE: CLIENT_ID below must be pre-registered in CI-Portal's PUBLIC_CLIENTS
 * with redirect_uri equal to this page's own URL (origin + pathname, no
 * query/hash). Sign-in will fail with an IdP error until that registration
 * exists — this file can't create it (that's a CI-Portal-side change).
 */
(function () {
  'use strict';

  var ISSUER = 'https://hub.ci.computer/api/auth';
  var CLIENT_ID = 'ci-er-connect';
  var SCOPE = 'openid email profile offline_access';
  var AGENT_HUB_PORT = 8787;

  var TOKENS_KEY = 'er-connect:oidc-tokens';
  var PENDING_KEY = 'er-connect:oidc-pending';
  var HUB_URL_KEY = 'er-connect:hub-url';

  var SERVICES = ['Assistant', 'Ollama', 'Hermes', 'OpenClaw', 'Memory'];

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
      var err = new Error('Token endpoint ' + res.status + ': ' + text.slice(0, 200));
      err.httpStatus = res.status;
      throw err;
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

  // ---- Hub connect (mirrors config/HubPresets.ts) --------------------------

  function hubHost(raw) {
    var trimmed = (raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;
    try {
      var u = new URL(withScheme);
      return u.protocol + '//' + u.hostname;
    } catch (e) {
      return null;
    }
  }

  function agentHubUrl(hubBaseUrl) {
    var host = hubHost(hubBaseUrl);
    return host ? host + ':' + AGENT_HUB_PORT : null;
  }

  async function probeHub(hubBaseUrl) {
    var url = agentHubUrl(hubBaseUrl);
    if (!url) return { ok: false, url: null };
    try {
      // no-cors: we can't read the response, but a resolved fetch means the
      // host answered (vs. a network-level failure for an unreachable host).
      await fetch(url, { mode: 'no-cors' });
      return { ok: true, url: url };
    } catch (e) {
      return { ok: false, url: url };
    }
  }

  // ---- UI wiring -------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var signedOutView = document.getElementById('signed-out-view');
    var signedInView = document.getElementById('signed-in-view');
    var identityLabel = document.getElementById('identity-label');
    var authHeading = document.getElementById('auth-heading');
    var authStatus = document.getElementById('auth-status');
    var signinBtn = document.getElementById('signin-btn');
    var hubInput = document.getElementById('hub-url');
    var connectBtn = document.getElementById('connect-btn');
    var connectStatus = document.getElementById('connect-status');
    var servicesEl = document.getElementById('services');

    function renderServices(state) {
      servicesEl.innerHTML = '';
      SERVICES.forEach(function (name) {
        var chip = document.createElement('span');
        chip.className = 'chip' + (state === 'live' ? ' live' : '');
        chip.textContent = name;
        servicesEl.appendChild(chip);
      });
    }

    function showSignedIn(identity) {
      signedOutView.style.display = 'none';
      signedInView.style.display = '';
      var who = identity && (identity.name || identity.email);
      identityLabel.innerHTML = who
        ? who + (identity.email && identity.email !== who ? '<small>' + identity.email + '</small>' : '')
        : 'Signed in';
      var signout = document.createElement('span');
      signout.className = 'signout';
      signout.textContent = 'Sign out';
      signout.addEventListener('click', function () {
        signOut();
        location.reload();
      });
      authHeading.querySelector('.signout') && authHeading.querySelector('.signout').remove();
      authHeading.appendChild(signout);
    }

    async function runConnect(auto) {
      var raw = hubInput.value.trim();
      if (!raw) {
        if (!auto) connectStatus.textContent = 'enter a Hub URL first';
        connectStatus.className = 'status';
        renderServices('idle');
        return;
      }
      localStorage.setItem(HUB_URL_KEY, raw);
      connectStatus.textContent = auto ? 'auto-connecting…' : 'connecting…';
      connectStatus.className = 'status';
      var result = await probeHub(raw);
      if (result.ok) {
        connectStatus.textContent = 'connected: ' + result.url;
        connectStatus.className = 'status ok';
        renderServices('live');
      } else {
        connectStatus.textContent = result.url ? 'unreachable: ' + result.url : 'invalid Hub URL';
        connectStatus.className = 'status err';
        renderServices('idle');
      }
    }

    renderServices('idle');
    connectBtn.addEventListener('click', function () { runConnect(false); });
    signinBtn.addEventListener('click', function () {
      signinBtn.disabled = true;
      authStatus.textContent = 'redirecting to CI-Portal…';
      beginSignIn().catch(function (err) {
        authStatus.textContent = 'sign-in failed: ' + err.message;
        authStatus.className = 'status err';
        signinBtn.disabled = false;
      });
    });

    var rememberedHub = localStorage.getItem(HUB_URL_KEY);
    if (rememberedHub) hubInput.value = rememberedHub;

    async function boot() {
      var tokens = null;

      if (isCallback()) {
        authStatus.textContent = 'completing sign-in…';
        try {
          tokens = await completeSignInFromCallback();
        } catch (err) {
          authStatus.textContent = 'sign-in failed: ' + err.message;
          authStatus.className = 'status err';
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

      authStatus.textContent = '';
      authStatus.className = 'status';
      showSignedIn(identityFromTokens(tokens));

      // Auto setup: once signed in, connect immediately using whatever Hub
      // URL is remembered on this device — no extra click needed.
      if (hubInput.value.trim()) runConnect(true);
    }

    boot();
  });
})();
