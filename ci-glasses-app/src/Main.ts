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
import { SettingsView } from './ui/SettingsView.ts';

async function main(): Promise<void> {
  // ── State ─────────────────────────────────────────────────────────────────
  const settings = new Settings();
  const adapter = new ApiAdapter(settings.get());
  const tts = new TTSPlayer();

  // ── Root layout ───────────────────────────────────────────────────────────
  const root = document.getElementById('app')!;

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
  const settingsView = new SettingsView(viewContainer, settings, adapter);

  settingsView.hide();

  // Tab switching
  chatTab.addEventListener('click', () => {
    chatTab.classList.add('tab-bar__tab--active');
    settingsTab.classList.remove('tab-bar__tab--active');
    chatView.show();
    settingsView.hide();
  });

  settingsTab.addEventListener('click', () => {
    settingsTab.classList.add('tab-bar__tab--active');
    chatTab.classList.remove('tab-bar__tab--active');
    settingsView.show();
    chatView.hide();
  });

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

    micCapture = new MicCapture(bridge);
    chatView.setMicCapture(micCapture);

    renderer = new GlassesRenderer(bridge);
    await renderer.init();

    await renderer.showStatus('CI Companion ready');

    // ── Ring / touchbar gesture handling ──────────────────────────────────
    bridge.onEvenHubEvent(async (event) => {
      const listEvt = event.listEvent;
      const textEvt = event.textEvent;
      const sysEvt = event.sysEvent;

      // Tap (click) → next page
      if (
        listEvt?.eventType === OsEventTypeList.CLICK_EVENT ||
        textEvt?.eventType === OsEventTypeList.CLICK_EVENT
      ) {
        await renderer?.nextPage();
      }

      // Double-click → abort in-flight request + clear conversation
      if (
        listEvt?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
        textEvt?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
      ) {
        currentAbortController?.abort();
        currentAbortController = null;
        adapter.clearHistory();
        chatView.addMessage({
          role: 'system',
          content: 'Conversation cleared.',
          timestamp: new Date(),
        });
        await renderer?.showStatus('Conversation cleared');
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

      // Foreground enter = long press start → begin recording
      if (
        sysEvt?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT ||
        textEvt?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT
      ) {
        await handleMicStart();
      }

      // Foreground exit = long press release → stop recording
      if (
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
    await renderer?.showStatus('⏳ Transcribing...');

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
      const whisper = new WhisperSTT(cfg.baseUrl, cfg.apiKey);
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
    // Cancel any in-flight request before starting a new one
    currentAbortController?.abort();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    statusBar.setStatus('thinking');
    await renderer?.showStatus('🤔 Thinking...');

    chatView.addMessage({
      role: 'user',
      content: userText,
      timestamp: new Date(),
    });

    // Add placeholder assistant message
    chatView.addMessage({
      role: 'assistant',
      content: '…',
      timestamp: new Date(),
    });

    let fullResponse = '';

    try {
      const stream = adapter.sendMessage(userText, signal);

      async function* streamWithChatViewUpdates(
        gen: ReturnType<ApiAdapter['sendMessage']>
      ): AsyncGenerator<string> {
        for await (const chunk of gen) {
          fullResponse += chunk;
          chatView.updateLastAssistantMessage(fullResponse);
          yield chunk;
        }
      }

      if (renderer) {
        await renderer.displayStreaming(streamWithChatViewUpdates(stream));
      } else {
        for await (const chunk of stream) {
          fullResponse += chunk;
          chatView.updateLastAssistantMessage(fullResponse);
        }
      }

      // Update glasses preview in the UI
      chatView.updateGlassesPreview(fullResponse);

      // Optional TTS
      const cfg = settings.get();
      if (cfg.ttsEnabled) {
        tts.setEnabled(true);
        tts.speak(fullResponse);
      }
    } catch (e) {
      // Ignore AbortError — this is an intentional cancellation (e.g. user
      // double-tapped to clear, or a new request was started).
      if (e instanceof DOMException && e.name === 'AbortError') {
        chatView.updateLastAssistantMessage('(cancelled)');
        return;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('AI request failed:', e);
      chatView.updateLastAssistantMessage(`❌ Error: ${errMsg}`);
      await renderer?.showStatus(`❌ ${errMsg.slice(0, 60)}`);
    } finally {
      statusBar.setStatus(bridge ? 'connected' : 'disconnected');
      chatView.setProcessingState(false);
    }
  }

  // ── Mic button callbacks from ChatView ────────────────────────────────────
  chatView.onMicStarted(handleMicStart);
  chatView.onMicStopped(handleMicStop);

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
