/**
 * ChatView.ts
 *
 * Renders the conversation history in the phone WebView and provides
 * a microphone button for voice input.
 */

import type { StatusBar } from './StatusBar.ts';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

type OnMicStartCallback = () => void;
type OnMicStopCallback = () => void;

export class ChatView {
  private el: HTMLElement;
  private messagesEl: HTMLElement;
  private micBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private glassesPreview: HTMLElement;
  private messages: ChatMessage[] = [];
  private onMicStart?: OnMicStartCallback;
  private onMicStop?: OnMicStopCallback;

  constructor(
    private container: HTMLElement,
    private statusBar: StatusBar
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chat-view';

    // Messages list
    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'chat-view__messages';

    // Glasses preview panel
    const previewWrapper = document.createElement('div');
    previewWrapper.style.padding = '0 16px 8px';

    const previewLabel = document.createElement('div');
    previewLabel.className = 'glasses-preview__label';
    previewLabel.textContent = 'Glasses display';

    this.glassesPreview = document.createElement('div');
    this.glassesPreview.className = 'glasses-preview';

    previewWrapper.appendChild(previewLabel);
    previewWrapper.appendChild(this.glassesPreview);

    // Controls bar
    const controls = document.createElement('div');
    controls.className = 'chat-view__controls';

    this.micBtn = document.createElement('button');
    this.micBtn.className = 'mic-btn';
    this.micBtn.title = 'Hold to record (or click to toggle)';
    this.micBtn.innerHTML = '🎙';

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'chat-hint';
    this.hintEl.textContent =
      'Tap mic to start recording. Long-press the G2 left touchbar to record directly from the glasses.';

    controls.appendChild(this.micBtn);
    controls.appendChild(this.hintEl);

    this.el.appendChild(this.messagesEl);
    this.el.appendChild(previewWrapper);
    this.el.appendChild(controls);
    this.container.appendChild(this.el);

    this.bindMicButton();
  }

  setMicCapture(_micCapture: unknown): void {
    // Reserved for future direct mic capture binding from the chat view
    // (currently mic capture is managed in Main.ts)
  }

  onMicStarted(cb: OnMicStartCallback): void {
    this.onMicStart = cb;
  }

  onMicStopped(cb: OnMicStopCallback): void {
    this.onMicStop = cb;
  }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    this.renderMessage(msg);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Update the last assistant message content (for streaming). */
  updateLastAssistantMessage(content: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant') {
      last.content = content;
      // Update the DOM
      const els = this.messagesEl.querySelectorAll<HTMLElement>(
        '.message--assistant'
      );
      const lastEl = els[els.length - 1];
      if (lastEl) {
        const body = lastEl.querySelector<HTMLElement>('.message__body');
        if (body) body.textContent = content;
      }
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  /** Update the glasses preview panel. */
  updateGlassesPreview(text: string): void {
    this.glassesPreview.textContent = text;
  }

  setMicState(state: 'idle' | 'recording'): void {
    this.micBtn.classList.toggle('mic-btn--recording', state === 'recording');
    this.micBtn.innerHTML = state === 'recording' ? '⏹' : '🎙';
  }

  setProcessingState(processing: boolean): void {
    this.micBtn.classList.toggle('mic-btn--processing', processing);
    this.micBtn.disabled = processing;
  }

  show(): void {
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private bindMicButton(): void {
    let recording = false;

    this.micBtn.addEventListener('click', async () => {
      if (!recording) {
        recording = true;
        this.setMicState('recording');
        this.statusBar.setStatus('recording');
        this.onMicStart?.();
      } else {
        recording = false;
        this.setMicState('idle');
        this.onMicStop?.();
      }
    });
  }

  private renderMessage(msg: ChatMessage): void {
    const el = document.createElement('div');
    el.className = `message message--${msg.role}`;

    const body = document.createElement('div');
    body.className = 'message__body';
    body.textContent = msg.content;

    el.appendChild(body);

    if (msg.role !== 'system') {
      const ts = document.createElement('div');
      ts.className = 'message__timestamp';
      ts.textContent = msg.timestamp.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      el.appendChild(ts);
    }

    this.messagesEl.appendChild(el);
  }
}
