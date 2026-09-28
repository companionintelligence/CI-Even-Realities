/**
 * Main.ts
 *
 * App bootstrap for the CI Companion Even Hub app.
 *
 * Interaction flow:
 *  1. User long-presses G2 left touchbar (or taps mic button in app) → record audio
 *  2. Release → STT transcribes audio
 *  3. Transcribed text sent to AI backend via ApiAdapter (streaming)
 *  4. Streamed response rendered on G2 display in real-time
 *  5. Ring tap navigates pages; double-tap clears conversation
 */

// Self-hosted Manrope (variable weight axis, the CI canon sans). Bundled woff2 is emitted as a
// same-origin asset by Vite, so it loads under the app's strict CSP
// (font-src 'self' data:) with NO Google Fonts / CDN request. Imported before
// styles.css so the @font-face rules register ahead of the token layer that
// references the "Manrope Variable" family via --font-sans.
import '@fontsource-variable/manrope';

import './ui/styles.css';

import {
  waitForEvenAppBridge,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

import { Settings } from './config/Settings.ts';
import { ApiAdapter } from './ai/ApiAdapter.ts';
import { MicCapture } from './audio/MicCapture.ts';
import { TTSPlayer } from './audio/TTSPlayer.ts';
import { WhisperSTT } from './stt/WhisperSTT.ts';
import { WebSpeechSTT } from './stt/WebSpeechSTT.ts';
import { GlassesRenderer } from './glasses/GlassesRenderer.ts';
import { StatusBar } from './ui/StatusBar.ts';
import { ChatView } from './ui/ChatView.ts';
import { SettingsView, type AuthPanel } from './ui/SettingsView.ts';
import { OidcClient } from './auth/OidcClient.ts';
import { AuthStore } from './auth/AuthStore.ts';
import { localStoragePort, bridgeStoragePort } from './auth/StoragePort.ts';
import {
  OidcTokenProvider,
  StaticKeyProvider,
  type TokenProvider,
} from './auth/TokenProvider.ts';

async function main(): Promise<void> {
  // Surface URL params early — used for `?screen=` deep-linking and for
  // simulator-time overrides (the Tauri webview can't reach loopback so
  // screenshots need a LAN-reachable hub URL passed via the URL).
  //
  // SECURITY: these overrides are applied for the **current session only**
  // and never written to localStorage. Otherwise any malicious deep-link
  // (e.g. emailed to the user) could silently rewrite the saved backend URL
  // and exfiltrate future prompts + the stored API key.
  const earlyParams = new URLSearchParams(window.location.search);
  const baseUrlOverride = earlyParams.get('baseUrl');
  const modelOverride = earlyParams.get('model');

  // ── State ─────────────────────────────────────────────────────────────────
  const settings = new Settings();
  const persisted = settings.get();
  // Build a non-persistent view of the config with overrides applied. The
  // Settings object itself stays clean — Reset / future reads still return
  // the user's saved values.
  const effectiveCfg = {
    ...persisted,
    ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
    ...(modelOverride ? { model: modelOverride } : {}),
  };
  const adapter = new ApiAdapter(effectiveCfg);
  const tts = new TTSPlayer();

  // ── Authentication (CI-Portal OIDC) ─────────────────────────────────────────
  // "Sign in with Companion Intelligence": Authorization-Code + PKCE against the
  // CI-Portal Better-Auth IdP. The access token then replaces the static API key
  // as the Bearer sent to the backend. Tokens persist via localStorage in
  // browser mode and are upgraded to device-backed bridge storage once the Even
  // Hub bridge is available.
  const oidcConfigFromSettings = () => {
    const c = settings.get();
    return { issuer: c.oidcIssuer, clientId: c.oidcClientId, scope: c.oidcScope };
  };
  const oidcClient = new OidcClient(oidcConfigFromSettings(), localStoragePort);
  const authStore = new AuthStore(oidcClient, localStoragePort);
  await authStore.load();

  let tokenProvider: TokenProvider;
  function refreshTokenProvider(): void {
    const c = settings.get();
    tokenProvider =
      c.authMode === 'oidc' && authStore.isSignedIn()
        ? new OidcTokenProvider(authStore)
        : new StaticKeyProvider(() => settings.get().apiKey);
    adapter.setTokenProvider(tokenProvider);
  }

  // Complete an in-flight redirect login before anything sends a request.
  if (OidcClient.isCallback(window.location.search)) {
    try {
      const tokens = await oidcClient.completeLoginFromRedirect(window.location.search);
      await authStore.signIn(tokens);
      settings.set({ authMode: 'oidc' });
    } catch (e) {
      console.error('OIDC sign-in failed:', e);
    } finally {
      // Strip code/state so a reload can't replay the (already consumed) code.
      window.history.replaceState(
        {},
        '',
        window.location.origin + window.location.pathname
      );
    }
  }
  refreshTokenProvider();

  const authPanel: AuthPanel = {
    isSignedIn: () => authStore.isSignedIn(),
    getIdentity: () => authStore.getIdentity(),
    signIn: async () => {
      oidcClient.updateConfig(oidcConfigFromSettings());
      await oidcClient.redirectToLogin();
    },
    signOut: async () => {
      await authStore.signOut();
      settings.set({ authMode: 'apiKey' });
      refreshTokenProvider();
    },
    completeManual: async (input: string) => {
      oidcClient.updateConfig(oidcConfigFromSettings());
      const tokens = await oidcClient.completeLoginFromRedirect(input);
      await authStore.signIn(tokens);
      settings.set({ authMode: 'oidc' });
      refreshTokenProvider();
    },
    applyConfig: () => oidcClient.updateConfig(oidcConfigFromSettings()),
  };

  /**
   * Glasses-side session id. Sent in chat-completion metadata so the hub can
   * correlate approve-POSTs with the in-flight agent process.
   */
  const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  /** Currently displayed permission prompt, if any. */
  let activePrompt: {
    id: string;
    approveOption: string;
    denyOption: string;
  } | null = null;

  // ── Root layout ───────────────────────────────────────────────────────────
  const root = document.getElementById('app')!;
  // Hide the inline splash as soon as the first paint is ready.
  // The CSS animation fades it out and pulls it out of the flow.
  requestAnimationFrame(() => document.body.classList.add('ready'));

  // Status bar
  const statusBar = new StatusBar(root);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  const chatTab = document.createElement('button');
  chatTab.className = 'tab-bar__tab tab-bar__tab--active';
  chatTab.textContent = '💬 Chat';

  const settingsTab = document.createElement('button');
  settingsTab.className = 'tab-bar__tab';
  settingsTab.textContent = '⚙️ Settings';

  tabBar.appendChild(chatTab);
  tabBar.appendChild(settingsTab);
  root.appendChild(tabBar);

  // View container
  const viewContainer = document.createElement('div');
  viewContainer.style.flex = '1';
  viewContainer.style.overflow = 'hidden';
  viewContainer.style.display = 'flex';
  viewContainer.style.flexDirection = 'column';
  root.appendChild(viewContainer);

  // Views
  const chatView = new ChatView(viewContainer, statusBar);
  const settingsView = new SettingsView(viewContainer, settings, adapter, authPanel);

  settingsView.hide();

  function showChat(): void {
    chatTab.classList.add('tab-bar__tab--active');
    settingsTab.classList.remove('tab-bar__tab--active');
    chatView.show();
    settingsView.hide();
  }
  function showSettings(): void {
    settingsTab.classList.add('tab-bar__tab--active');
    chatTab.classList.remove('tab-bar__tab--active');
    settingsView.show();
    chatView.hide();
  }

  chatTab.addEventListener('click', showChat);
  settingsTab.addEventListener('click', showSettings);

  // Deep-link via ?screen=settings|prompt — used by the simulator's
  // automation API to capture portal screenshots without manual clicks.
  // The `prompt` variant fires after the SDK bridge is ready (below).
  const params = new URLSearchParams(window.location.search);
  const screen = params.get('screen');
  if (screen === 'settings') showSettings();

  // Update model display in status bar
  statusBar.setModel(settings.get().model);

  // ── SDK Bridge ────────────────────────────────────────────────────────────
  let bridge: EvenAppBridge | null = null;
  let micCapture: MicCapture | null = null;
  let renderer: GlassesRenderer | null = null;

  try {
    bridge = await waitForEvenAppBridge();
    statusBar.connectBridge(bridge);
    statusBar.setStatus('connected');

    // Upgrade token persistence to device-backed bridge storage and pick up a
    // session saved on a previous on-device launch, then re-sync the provider.
    const activeBridge = bridge;
    try {
      await authStore.useStorage(
        bridgeStoragePort({
          setLocalStorage: (k, v) => activeBridge.setLocalStorage(k, v),
          getLocalStorage: (k) => activeBridge.getLocalStorage(k),
        })
      );
      refreshTokenProvider();
      settingsView.refresh();
      statusBar.setModel(settings.get().model);
    } catch (e) {
      console.warn('Auth storage upgrade failed:', e);
    }

    micCapture = new MicCapture(bridge);
    chatView.setMicCapture(micCapture);

    renderer = new GlassesRenderer(bridge);
    await renderer.init();

    await renderer.showStatus('CI Companion ready');

    // `?screen=prompt` — render a synthetic permission_prompt card so the
    // simulator can capture portal screenshots. Disabled in production by
    // the absence of the query param. The fake prompt cannot be approved
    // (there's no live agent backing it).
    if (screen === 'prompt') {
      activePrompt = {
        id: 'demo-prompt',
        approveOption: 'approve',
        denyOption: 'deny',
      };
      await renderer.displayPromptCard({
        tool: 'Bash',
        summary: 'Run `git push origin main` from /repo/ci-server?',
      });
    }
    // `?screen=stream&q=<text>` — fire a real query through the configured
    // backend on boot so the simulator can capture a mid-stream HUD frame.
    if (screen === 'stream') {
      const q = params.get('q') ?? 'What is bluetooth low energy in one short sentence?';
      // Defer slightly so the bridge has settled before we kick off the stream.
      setTimeout(() => { void sendToAI(q); }, 250);
    }

    // ── Ring / touchbar gesture handling ──────────────────────────────────
    bridge.onEvenHubEvent(async (event) => {
      const listEvt = event.listEvent;
      const textEvt = event.textEvent;
      const sysEvt = event.sysEvent;

      // Tap (click) — DENY active prompt if one is showing, else next page.
      // Deny on single-tap is deliberate: an accidental brush of the touchbar
      // must never approve an agent action (e.g. a Bash command). A denial is
      // recoverable — the agent can simply re-ask.
      if (
        listEvt?.eventType === OsEventTypeList.CLICK_EVENT ||
        textEvt?.eventType === OsEventTypeList.CLICK_EVENT
      ) {
        if (activePrompt) {
          await respondToPrompt(activePrompt.denyOption, '🚫 Denied');
        } else {
          await renderer?.nextPage();
        }
      }

      // Double-click — APPROVE active prompt if one is showing (a double-tap
      // is a deliberate gesture, unlikely to happen by accident), else clear
      // the conversation.
      if (
        listEvt?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
        textEvt?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
      ) {
        if (activePrompt) {
          await respondToPrompt(activePrompt.approveOption, '✅ Approved');
        } else {
          currentAbortController?.abort();
          currentAbortController = null;
          // A dropped local fetch no longer stops the hub's turn on its own
          // (it may be reconnected to instead) — tell it explicitly so a
          // still-running coding-agent subprocess doesn't keep burning
          // tokens/tools after the user has cleared the conversation.
          void adapter.cancelSession(sessionId);
          adapter.clearHistory();
          chatView.addMessage({
            role: 'system',
            content: 'Conversation cleared.',
            timestamp: new Date(),
          });
          await renderer?.showStatus('Conversation cleared');
        }
      }

      // Scroll up → previous page
      if (
        listEvt?.eventType === OsEventTypeList.SCROLL_TOP_EVENT
      ) {
        await renderer?.prevPage();
      }

      // Scroll down → next page
      if (
        listEvt?.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT
      ) {
        await renderer?.nextPage();
      }

      // Long-press start → begin recording. SDK ≥0.0.16 reports this natively
      // via LONG_PRESS_EVENT; FOREGROUND_ENTER_EVENT is kept as a fallback for
      // firmware/simulator paths that still route the gesture that way (see
      // notes/even-realities-resources.md — simulator vs. hardware event
      // routing quirks). handleMicStart() is idempotent, so if both fire for
      // the same physical press this is a harmless no-op the second time.
      if (
        sysEvt?.eventType === OsEventTypeList.LONG_PRESS_EVENT ||
        textEvt?.eventType === OsEventTypeList.LONG_PRESS_EVENT ||
        sysEvt?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT ||
        textEvt?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT
      ) {
        await handleMicStart();
      }

      // Long-press release → stop recording. Same native-first, foreground
      // fallback pairing as the start event above.
      if (
        sysEvt?.eventType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT ||
        textEvt?.eventType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT ||
        sysEvt?.eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
        textEvt?.eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT
      ) {
        await handleMicStop();
      }
    });
  } catch (err) {
    console.warn('Even Hub bridge not available — running in browser mode', err);
    statusBar.setStatus('disconnected');
  }

  // ── Voice pipeline ────────────────────────────────────────────────────────
  let currentAbortController: AbortController | null = null;

  /**
   * Fire a HUD update without letting a render failure break the app flow.
   * The phone webview is the source of truth; the glasses display is
   * best-effort (the SDK can hand back a bridge whose container calls fail,
   * e.g. in plain-browser mode).
   */
  async function safeHud(update: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await update();
    } catch (e) {
      console.warn('Glasses HUD update failed — continuing phone-only:', e);
    }
  }

  async function handleMicStart(): Promise<void> {
    if (!micCapture) return;
    try {
      statusBar.setStatus('recording');
      chatView.setMicState('recording');
      await renderer?.showStatus('🎙 Listening...');
      await micCapture.startCapture();
    } catch (e) {
      console.error('Mic start failed:', e);
      statusBar.setStatus('connected');
      chatView.setMicState('idle');
    }
  }

  async function handleMicStop(): Promise<void> {
    if (!micCapture || micCapture.getState() !== 'recording') return;

    statusBar.setStatus('processing');
    chatView.setMicState('idle');
    chatView.setProcessingState(true);
    await safeHud(() => renderer?.showStatus('⏳ Transcribing...'));

    let userText = '';
    try {
      const audioBuffer = await micCapture.stopCapture();
      userText = await transcribeAudio(audioBuffer);
    } catch (e) {
      console.error('STT failed:', e);
      await renderer?.showStatus('❌ Transcription failed');
      statusBar.setStatus('connected');
      chatView.setProcessingState(false);
      return;
    }

    if (!userText.trim()) {
      await renderer?.showStatus('(no speech detected)');
      statusBar.setStatus('connected');
      chatView.setProcessingState(false);
      return;
    }

    await sendToAI(userText);
  }

  async function transcribeAudio(audio: ArrayBuffer): Promise<string> {
    const cfg = settings.get();
    if (cfg.sttProvider === 'whisper') {
      const whisper = new WhisperSTT(cfg.baseUrl, cfg.apiKey, undefined, tokenProvider);
      return whisper.transcribe(audio, 'wav');
    } else {
      const webSpeech = new WebSpeechSTT();
      if (!webSpeech.isAvailable()) {
        throw new Error('Web Speech API not available');
      }
      return webSpeech.transcribe();
    }
  }

  async function sendToAI(userText: string): Promise<void> {
    // Cancel any in-flight request before starting a new one — abort the
    // local fetch AND tell the hub to stop the superseded turn server-side,
    // since a dropped connection alone no longer does that (see
    // ApiAdapter.cancelSession).
    currentAbortController?.abort();
    void adapter.cancelSession(sessionId);
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    statusBar.setStatus('thinking');
    activePrompt = null;
    try {
      await renderer?.showStatus('🤔 Thinking...');
    } catch (e) {
      console.error('Failed to update glasses thinking status:', e);
    }

    chatView.addMessage({
      role: 'user',
      content: userText,
      timestamp: new Date(),
    });

    chatView.addMessage({
      role: 'assistant',
      content: '…',
      timestamp: new Date(),
    });

    let fullResponse = '';
    let lastDisplayFlush = 0;
    const DISPLAY_THROTTLE_MS = 150;

    // Tracks whether the *most recent* flush in THIS turn failed, purely to
    // avoid spamming the console on every throttled tick — the status bar
    // itself is always synced to the actual outcome below (it's a persistent
    // indicator that must reflect reality across turn boundaries, not just
    // within this turn's local state). Unlike the old permanent-for-the-turn
    // latch, each tick still retries — a BLE hiccup can clear mid-turn
    // (GlassesRenderer itself now also retries internally before a call here
    // ever fails) and the HUD should resume updating on its own.
    let hudDegradedThisTurn = false;
    async function flushGlasses(force = false): Promise<void> {
      if (!renderer || activePrompt) return;
      const now = Date.now();
      if (!force && now - lastDisplayFlush < DISPLAY_THROTTLE_MS) return;
      lastDisplayFlush = now;
      try {
        await renderer.displayText(fullResponse);
        hudDegradedThisTurn = false;
        statusBar.setHudDegraded(false);
      } catch (e) {
        // A HUD render failure must never kill the conversation: the phone
        // webview still shows the streamed answer. Seen live when the SDK
        // resolves a bridge in a plain browser whose container calls then
        // fail ("both textContainerUpgrade and rebuildPageContainer failed").
        if (!hudDegradedThisTurn) {
          console.warn('Glasses HUD render failed — continuing phone-only:', e);
        }
        hudDegradedThisTurn = true;
        statusBar.setHudDegraded(true);
      }
    }

    try {
      // Read settings at call time so a mid-session toggle takes effect on
      // the very next message. `use_memory` asks the hub to recall from
      // Companion Memory before replying and save the exchange back after.
      const stream = adapter.sendMessageEvents(userText, signal, {
        session_id: sessionId,
        use_memory: settings.get().useMemory,
      });

      for await (const evt of stream) {
        if (evt.type === 'text') {
          fullResponse += evt.delta;
          chatView.updateLastAssistantMessage(fullResponse);
          await flushGlasses();
        } else if (evt.type === 'agent_status') {
          const label = evt.label ?? evt.kind;
          await safeHud(() => renderer?.showStatus(`⏳ ${label}`));
          statusBar.setStatus(
            evt.kind === 'thinking' || evt.kind === 'awaiting_input'
              ? 'thinking'
              : evt.kind === 'executing'
                ? 'processing'
                : bridge ? 'connected' : 'disconnected'
          );
        } else if (evt.type === 'permission_prompt') {
          const approveOpt =
            evt.options.find((o) => o.id === 'approve') ?? evt.options[0];
          const denyOpt =
            evt.options.find((o) => o.id === 'deny') ??
            evt.options[1] ??
            evt.options[0];
          activePrompt = {
            id: evt.id,
            approveOption: approveOpt?.id ?? 'approve',
            denyOption: denyOpt?.id ?? 'deny',
          };
          chatView.addMessage({
            role: 'system',
            content: `🔐 ${evt.tool}: ${evt.summary}`,
            timestamp: new Date(),
          });
          await safeHud(() =>
            renderer?.displayPromptCard({
              tool: evt.tool,
              summary: evt.summary,
              approveLabel: approveOpt?.label,
              denyLabel: denyOpt?.label,
            })
          );
          statusBar.setStatus('thinking');
        } else if (evt.type === 'error') {
          throw new Error(evt.message);
        }
      }

      await flushGlasses(true);
      chatView.updateGlassesPreview(fullResponse);

      const cfg = settings.get();
      if (cfg.ttsEnabled && fullResponse) {
        tts.setEnabled(true);
        tts.speak(fullResponse);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        chatView.updateLastAssistantMessage('(cancelled)');
        return;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('AI request failed:', e);
      chatView.updateLastAssistantMessage(`❌ Error: ${errMsg}`);
      await safeHud(() => renderer?.showStatus(`❌ ${errMsg.slice(0, 60)}`));
    } finally {
      statusBar.setStatus(bridge ? 'connected' : 'disconnected');
      chatView.setProcessingState(false);
    }
  }

  async function respondToPrompt(optionId: string, hudMsg: string): Promise<void> {
    if (!activePrompt) return;
    const prompt = activePrompt;
    // Clear optimistically; we restore it on failure so the user can retry
    // (the prompt card is still on-screen unless something else over-wrote
    // the HUD, but the gesture state machine needs activePrompt to route
    // taps back to respondToPrompt instead of nextPage).
    activePrompt = null;
    try {
      const ok = await adapter.approvePrompt(sessionId, prompt.id, optionId);
      if (ok) {
        await renderer?.showStatus(hudMsg);
        chatView.addMessage({
          role: 'system',
          content: `${hudMsg} (${prompt.id})`,
          timestamp: new Date(),
        });
      } else {
        // Hub rejected — surface the actual outcome and let the user retry.
        activePrompt = prompt;
        await renderer?.showStatus('❌ failed — 2×tap: approve · tap: deny');
        chatView.addMessage({
          role: 'system',
          content: `❌ Failed to deliver "${optionId}" for ${prompt.id} — retry (2×tap: approve · tap: deny)`,
          timestamp: new Date(),
        });
      }
    } catch (e) {
      console.error('approve failed:', e);
      activePrompt = prompt;
      const msg = e instanceof Error ? e.message : String(e);
      await renderer?.showStatus('❌ failed — 2×tap: approve · tap: deny');
      chatView.addMessage({
        role: 'system',
        content: `❌ Approve threw: ${msg}`,
        timestamp: new Date(),
      });
    }
  }

  // ── Mic button callbacks from ChatView ────────────────────────────────────
  chatView.onMicStarted(handleMicStart);
  chatView.onMicStopped(handleMicStop);
  chatView.onQuickActionPicked((prompt) => { void sendToAI(prompt); });

  // ── Add welcome message ────────────────────────────────────────────────────
  chatView.addMessage({
    role: 'system',
    content: bridge
      ? '✅ Connected to Even G2. Tap the mic or long-press the G2 touchbar to start.'
      : '⚠️ Running in browser mode (Even Hub bridge not available).',
    timestamp: new Date(),
  });

  // Keep status bar model in sync when settings change
  window.addEventListener('storage', () => {
    statusBar.setModel(settings.get().model);
  });
}

main().catch(console.error);
