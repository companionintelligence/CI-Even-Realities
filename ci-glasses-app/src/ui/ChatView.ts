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
type OnQuickActionCallback = (prompt: string) => void;

/**
 * Quick-action chips shown on the empty Chat tab. Tapping a chip fills in
 * a starter prompt — handy for users figuring out what kinds of questions
 * the assistant handles well. Kept short so they fit a phone screen.
 */
const QUICK_ACTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'What time is it?', prompt: 'What time is it right now?' },
  { label: 'Quick weather', prompt: 'Give me a 1-sentence weather summary.' },
  { label: 'Read me my next event', prompt: 'What is my next calendar event?' },
  { label: 'Set a 5-min timer', prompt: 'Start a 5 minute timer.' },
  { label: 'Define a word', prompt: 'Define the word "ephemeral" in one line.' },
  // Ecosystem chips — most useful with the Memory / Hermes / OpenClaw presets.
  { label: 'What do you know about…', prompt: 'What do you know about ' },
  { label: 'Recall my recent notes', prompt: 'Recall my most recent notes and summarize them.' },
];

export class ChatView {
  private el: HTMLElement;
  private messagesEl: HTMLElement;
  private emptyEl: HTMLElement;
  private micBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private glassesPreview: HTMLElement;
  private messages: ChatMessage[] = [];
  private onMicStart?: OnMicStartCallback;
  private onMicStop?: OnMicStopCallback;
  private onQuickAction?: OnQuickActionCallback;

  constructor(
    private container: HTMLElement,
    private statusBar: StatusBar
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chat-view';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'chat-view__messages';

    this.emptyEl = this.buildEmptyState();
    this.messagesEl.appendChild(this.emptyEl);

    const previewWrapper = document.createElement('div');
    previewWrapper.className = 'glasses-preview-wrapper';

    const previewLabel = document.createElement('div');
    previewLabel.className = 'glasses-preview__label';
    previewLabel.textContent = 'Glasses display';

    this.glassesPreview = document.createElement('div');
    this.glassesPreview.className = 'glasses-preview';
    this.glassesPreview.textContent = '';

    previewWrapper.appendChild(previewLabel);
    previewWrapper.appendChild(this.glassesPreview);

    const controls = document.createElement('div');
    controls.className = 'chat-view__controls';

    this.micBtn = document.createElement('button');
    this.micBtn.className = 'mic-btn';
    this.micBtn.title = 'Tap to record (or long-press the G2 touchbar)';
    this.micBtn.setAttribute('aria-label', 'Start voice recording');
    this.micBtn.innerHTML = micSvg('idle');

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'chat-hint';
    this.hintEl.textContent =
      'Tap the mic, or long-press the G2 left touchbar to record from the glasses.';

    controls.appendChild(this.micBtn);
    controls.appendChild(this.hintEl);

    this.el.appendChild(this.messagesEl);
    this.el.appendChild(previewWrapper);
    this.el.appendChild(controls);
    this.container.appendChild(this.el);

    this.bindMicButton();
  }

  setMicCapture(_micCapture: unknown): void {
    // Reserved for future direct mic capture binding from the chat view.
  }

  onMicStarted(cb: OnMicStartCallback): void { this.onMicStart = cb; }
  onMicStopped(cb: OnMicStopCallback): void { this.onMicStop = cb; }
  onQuickActionPicked(cb: OnQuickActionCallback): void { this.onQuickAction = cb; }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    // System pills (status, errors, welcomes) don't count as "real" content;
    // keep the empty-state visible until the user actually asks something.
    if (msg.role !== 'system') {
      this.emptyEl.style.display = 'none';
    }
    this.renderMessage(msg);
    if (msg.role === 'assistant' && msg.content === '…') {
      this.setStreaming(true);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Update the last assistant message content (for streaming). */
  updateLastAssistantMessage(content: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant') {
      last.content = content;
      const els = this.messagesEl.querySelectorAll<HTMLElement>(
        '.message--assistant'
      );
      const lastEl = els[els.length - 1];
      if (lastEl) {
        const body = lastEl.querySelector<HTMLElement>('.message__body');
        if (body) body.textContent = content;
        if (content && content !== '…') {
          lastEl.classList.remove('message--skeleton');
        }
      }
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  /** Mark the most-recent assistant message as actively streaming (caret). */
  setStreaming(on: boolean): void {
    const els = this.messagesEl.querySelectorAll<HTMLElement>(
      '.message--assistant'
    );
    const last = els[els.length - 1];
    if (!last) return;
    last.classList.toggle('message--streaming', on);
    if (on && last.querySelector('.message__body')?.textContent === '…') {
      // Replace the lone "…" placeholder with a skeleton until real text arrives.
      this.injectSkeleton(last);
    }
  }

  /** Update the glasses preview panel. */
  updateGlassesPreview(text: string): void {
    this.glassesPreview.textContent = text;
  }

  setMicState(state: 'idle' | 'recording'): void {
    this.micBtn.classList.toggle('mic-btn--recording', state === 'recording');
    this.micBtn.innerHTML = micSvg(state);
    this.micBtn.setAttribute(
      'aria-label',
      state === 'recording' ? 'Stop recording' : 'Start voice recording'
    );
  }

  setProcessingState(processing: boolean): void {
    this.micBtn.classList.toggle('mic-btn--processing', processing);
    this.micBtn.disabled = processing;
    if (!processing) this.setStreaming(false);
  }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }

  private bindMicButton(): void {
    let recording = false;

    this.micBtn.addEventListener('click', () => {
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

  private injectSkeleton(messageEl: HTMLElement): void {
    const body = messageEl.querySelector<HTMLElement>('.message__body');
    if (!body) return;
    body.textContent = '';
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('div');
      line.className = 'skeleton-line';
      body.appendChild(line);
    }
  }

  private buildEmptyState(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const mark = document.createElement('img');
    mark.className = 'empty-state__mark';
    mark.src = '/icon.png';
    mark.alt = '';
    wrap.appendChild(mark);

    const title = document.createElement('div');
    title.className = 'empty-state__title';
    title.textContent = 'Ready when you are';
    wrap.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'empty-state__sub';
    sub.textContent =
      'Tap the mic below or long-press the G2 touchbar to ask anything. Answers stream onto the glasses HUD.';
    wrap.appendChild(sub);

    const chips = document.createElement('div');
    chips.className = 'empty-state__chips';
    for (const q of QUICK_ACTIONS) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = q.label;
      chip.addEventListener('click', () => this.onQuickAction?.(q.prompt));
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);

    return wrap;
  }
}

/**
 * Inline SVG for the mic button so we don't depend on a font emoji that
 * renders inconsistently across the simulator and real Even Hub WebView.
 */
function micSvg(state: 'idle' | 'recording'): string {
  if (state === 'recording') {
    // Solid square = "stop"
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
    </svg>`;
  }
  // Microphone glyph
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3"/>
    <path d="M5 11a7 7 0 0 0 14 0"/>
    <line x1="12" y1="18" x2="12" y2="21"/>
    <line x1="9" y1="21" x2="15" y2="21"/>
  </svg>`;
}
