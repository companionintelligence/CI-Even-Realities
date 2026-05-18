/**
 * SettingsView.ts
 *
 * Renders the settings/configuration panel in the phone WebView.
 * Allows configuring the AI backend URL, API key, model, API mode, STT provider, etc.
 */

import type { Settings, BackendConfig } from '../config/Settings.ts';
import type { ApiAdapter } from '../ai/ApiAdapter.ts';

export class SettingsView {
  private el: HTMLElement;

  constructor(
    private container: HTMLElement,
    private settings: Settings,
    private adapter: ApiAdapter
  ) {
    this.el = document.createElement('div');
    this.el.className = 'settings-view';
    this.container.appendChild(this.el);
    this.render();
  }

  show(): void {
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private render(): void {
    this.el.innerHTML = '';
    const cfg = this.settings.get();

    // ── Backend section ──────────────────────────────────────────────────────
    const backendSection = this.makeSection('AI Backend');

    backendSection.appendChild(
      this.makeSelectRow('Backend Kind', 'backendKind', cfg.backendKind, [
        { value: 'openai', label: 'OpenAI-compatible (any URL)' },
        { value: 'local-llm', label: 'Local LLM (Ollama / vLLM / Hermes)' },
        { value: 'claude-cli', label: 'Claude Code via agent-hub' },
        { value: 'codex-cli', label: 'Codex CLI via agent-hub' },
        { value: 'openclaw', label: 'OpenClaw via agent-hub' },
      ])
    );

    backendSection.appendChild(
      this.makeTextRow('Backend URL', 'baseUrl', cfg.baseUrl, {
        hint: 'OpenAI-compatible endpoint (typically your agent-hub on the LAN)',
        placeholder: 'http://localhost:8080',
      })
    );

    backendSection.appendChild(
      this.makeTextRow('API Key', 'apiKey', cfg.apiKey, {
        type: 'password',
        hint: 'Bearer token for the AI backend',
        placeholder: 'sk-...',
      })
    );

    backendSection.appendChild(
      this.makeTextRow('Model', 'model', cfg.model, {
        hint: 'e.g. gpt-4o, llama3, ci-companion',
        placeholder: 'ci-companion',
      })
    );

    backendSection.appendChild(
      this.makeSelectRow('API Mode', 'apiMode', cfg.apiMode, [
        { value: 'auto', label: 'Auto (detect, prefer Responses API)' },
        { value: 'responses', label: 'Responses API (new)' },
        { value: 'completions', label: 'Chat Completions (legacy)' },
      ])
    );

    backendSection.appendChild(
      this.makeToggleRow('Streaming', 'streaming', cfg.streaming, {
        hint: 'Stream responses in real-time',
      })
    );

    backendSection.appendChild(
      this.makeToggleRow(
        'Server-side context',
        'storeContext',
        cfg.storeContext,
        { hint: 'Responses API: store conversation on server (store: true)' }
      )
    );

    // Test connection button
    const testRow = document.createElement('div');
    testRow.className = 'settings-row';
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn--secondary';
    testBtn.textContent = 'Test Connection';
    const testResult = document.createElement('div');

    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      testResult.textContent = '';
      testResult.className = '';
      try {
        const result = await this.adapter.testConnection();
        testResult.className = `connection-result connection-result--${result.reachable ? 'ok' : 'error'}`;
        if (result.reachable) {
          testResult.textContent = [
            '✓ Backend reachable',
            result.supportsCompletions ? '✓ Chat Completions' : '✗ Chat Completions',
            result.supportsResponses ? '✓ Responses API' : '✗ Responses API',
          ].join('\n');
        } else {
          testResult.textContent = `✗ Could not reach backend\n${result.error ?? ''}`;
        }
      } catch (e) {
        testResult.className = 'connection-result connection-result--error';
        testResult.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
    });

    testRow.appendChild(testBtn);
    testRow.appendChild(testResult);
    backendSection.appendChild(testRow);

    // ── System prompt ────────────────────────────────────────────────────────
    const promptSection = this.makeSection('System Prompt');
    promptSection.appendChild(
      this.makeTextareaRow(
        'Instructions',
        'systemPrompt',
        cfg.systemPrompt,
        { hint: 'Default system instructions sent to the AI' }
      )
    );

    // ── STT section ──────────────────────────────────────────────────────────
    const sttSection = this.makeSection('Speech-to-Text');

    sttSection.appendChild(
      this.makeSelectRow('STT Provider', 'sttProvider', cfg.sttProvider, [
        { value: 'whisper', label: 'OpenAI Whisper (REST)' },
        { value: 'webspeech', label: 'Web Speech API (browser, uses Google)' },
      ])
    );

    // ── TTS section ──────────────────────────────────────────────────────────
    const ttsSection = this.makeSection('Text-to-Speech');
    ttsSection.appendChild(
      this.makeToggleRow(
        'Audio TTS',
        'ttsEnabled',
        cfg.ttsEnabled,
        { hint: 'Speak AI response aloud via phone speaker (optional)' }
      )
    );

    // ── Danger zone ──────────────────────────────────────────────────────────
    const dangerSection = this.makeSection('Reset');
    const dangerRow = document.createElement('div');
    dangerRow.className = 'settings-row';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn--danger';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all settings to defaults?')) {
        this.settings.reset();
        this.adapter.updateConfig(this.settings.get());
        this.render();
      }
    });
    dangerRow.appendChild(resetBtn);
    dangerSection.appendChild(dangerRow);

    this.el.appendChild(backendSection);
    this.el.appendChild(promptSection);
    this.el.appendChild(sttSection);
    this.el.appendChild(ttsSection);
    this.el.appendChild(dangerSection);
  }

  private makeSection(title: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-section__title';
    titleEl.textContent = title;

    section.appendChild(titleEl);
    return section;
  }

  private makeTextRow(
    label: string,
    key: keyof BackendConfig,
    value: string,
    opts: { hint?: string; placeholder?: string; type?: string } = {}
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'settings-row__label';
    labelEl.textContent = label;

    if (opts.hint) {
      const hint = document.createElement('div');
      hint.className = 'settings-row__hint';
      hint.textContent = opts.hint;
      row.appendChild(labelEl);
      row.appendChild(hint);
    } else {
      row.appendChild(labelEl);
    }

    const input = document.createElement('input');
    input.className = 'settings-input';
    input.type = opts.type ?? 'text';
    input.value = value;
    input.placeholder = opts.placeholder ?? '';
    input.addEventListener('change', () => {
      this.settings.set({ [key]: input.value } as Partial<BackendConfig>);
      this.adapter.updateConfig(this.settings.get());
    });

    row.appendChild(input);
    return row;
  }

  private makeTextareaRow(
    label: string,
    key: keyof BackendConfig,
    value: string,
    opts: { hint?: string } = {}
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'settings-row__label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    if (opts.hint) {
      const hint = document.createElement('div');
      hint.className = 'settings-row__hint';
      hint.textContent = opts.hint;
      row.appendChild(hint);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'settings-input';
    textarea.rows = 4;
    textarea.value = value;
    textarea.style.resize = 'vertical';
    textarea.addEventListener('change', () => {
      this.settings.set({ [key]: textarea.value } as Partial<BackendConfig>);
      this.adapter.updateConfig(this.settings.get());
    });

    row.appendChild(textarea);
    return row;
  }

  private makeSelectRow(
    label: string,
    key: keyof BackendConfig,
    value: string,
    options: Array<{ value: string; label: string }>
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'settings-row__label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const select = document.createElement('select');
    select.className = 'settings-select';
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.settings.set({ [key]: select.value } as Partial<BackendConfig>);
      this.adapter.updateConfig(this.settings.get());
    });

    row.appendChild(select);
    return row;
  }

  private makeToggleRow(
    label: string,
    key: keyof BackendConfig,
    value: boolean,
    opts: { hint?: string } = {}
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const toggle = document.createElement('div');
    toggle.className = 'settings-toggle';

    const labelContainer = document.createElement('label');
    labelContainer.className = 'toggle-switch';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = value;
    checkbox.addEventListener('change', () => {
      this.settings.set({ [key]: checkbox.checked } as Partial<BackendConfig>);
      this.adapter.updateConfig(this.settings.get());
    });

    const track = document.createElement('span');
    track.className = 'toggle-switch__track';

    labelContainer.appendChild(checkbox);
    labelContainer.appendChild(track);

    const textWrapper = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'settings-row__label';
    labelEl.textContent = label;
    textWrapper.appendChild(labelEl);

    if (opts.hint) {
      const hint = document.createElement('div');
      hint.className = 'settings-row__hint';
      hint.textContent = opts.hint;
      textWrapper.appendChild(hint);
    }

    toggle.appendChild(labelContainer);
    toggle.appendChild(textWrapper);
    row.appendChild(toggle);
    return row;
  }
}
