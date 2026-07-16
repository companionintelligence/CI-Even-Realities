/**
 * SettingsView.ts
 *
 * Renders the settings/configuration panel in the phone WebView.
 * Allows configuring the AI backend URL, API key, model, API mode, STT provider, etc.
 */

import type { Settings, BackendConfig } from '../config/Settings.ts';
import type { ApiAdapter } from '../ai/ApiAdapter.ts';
import { hubPresets, type HubService } from '../config/HubPresets.ts';

/**
 * Bridge to the OIDC session, implemented by Main.ts. Kept as a narrow
 * interface so SettingsView stays testable and the auth machinery is optional
 * (the Account section is hidden when no panel is supplied).
 */
export interface AuthPanel {
  isSignedIn(): boolean;
  getIdentity(): { name?: string; email?: string };
  /** Begin the redirect login (navigates the WebView to CI-Portal). */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Manual fallback: finish sign-in from a pasted redirect URL or code. */
  completeManual(input: string): Promise<void>;
  /** Re-read OIDC settings (issuer/client/scope) into the live client. */
  applyConfig(): void;
}

export class SettingsView {
  private el: HTMLElement;

  constructor(
    private container: HTMLElement,
    private settings: Settings,
    private adapter: ApiAdapter,
    private auth?: AuthPanel
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

  /** Re-render the panel (e.g. after sign-in state changes). */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.el.innerHTML = '';
    const cfg = this.settings.get();

    // ── Account (CI-Portal OIDC) ─────────────────────────────────────────────
    const accountSection = this.auth ? this.makeAccountSection() : null;

    // ── CI-Hub quick-connect ─────────────────────────────────────────────────
    const hubSection = this.makeHubSection();

    // ── Backend section ──────────────────────────────────────────────────────
    const backendSection = this.makeSection('AI Backend');

    backendSection.appendChild(
      this.makeKindPicker(cfg.backendKind)
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

    if (accountSection) this.el.appendChild(accountSection);
    this.el.appendChild(hubSection);
    this.el.appendChild(backendSection);
    this.el.appendChild(promptSection);
    this.el.appendChild(sttSection);
    this.el.appendChild(ttsSection);
    this.el.appendChild(dangerSection);
  }

  /**
   * "Sign in with Companion Intelligence" — CI-Portal OIDC. Shows the signed-in
   * identity + Sign out when authenticated, otherwise a sign-in button plus a
   * manual code-paste fallback (for WebViews that can't round-trip the
   * redirect). Advanced issuer/client/scope fields live in a collapsible block.
   */
  private makeAccountSection(): HTMLElement {
    const auth = this.auth!;
    const cfg = this.settings.get();
    const section = this.makeSection('Account');

    const signedIn = auth.isSignedIn();

    const status = document.createElement('div');
    status.className = `account-status account-status--${signedIn ? 'in' : 'out'}`;
    if (signedIn) {
      const id = auth.getIdentity();
      status.textContent = `✓ Signed in${id.name ? ` as ${id.name}` : ''}${
        id.email && id.email !== id.name ? ` (${id.email})` : ''
      }`;
    } else {
      status.textContent = 'Not signed in — using the API key below.';
    }
    section.appendChild(status);

    const actionRow = document.createElement('div');
    actionRow.className = 'settings-row';
    if (signedIn) {
      const outBtn = document.createElement('button');
      outBtn.className = 'btn btn--secondary';
      outBtn.textContent = 'Sign out';
      outBtn.addEventListener('click', async () => {
        outBtn.disabled = true;
        await auth.signOut();
        this.settings.set({ authMode: 'apiKey' });
        this.adapter.updateConfig(this.settings.get());
        this.render();
      });
      actionRow.appendChild(outBtn);
    } else {
      const inBtn = document.createElement('button');
      inBtn.className = 'btn btn--primary';
      inBtn.textContent = 'Sign in with Companion Intelligence';
      inBtn.addEventListener('click', async () => {
        inBtn.disabled = true;
        this.settings.set({ authMode: 'oidc' });
        auth.applyConfig();
        try {
          await auth.signIn();
        } catch (e) {
          inBtn.disabled = false;
          status.className = 'account-status account-status--out';
          status.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`;
        }
      });
      actionRow.appendChild(inBtn);
    }
    section.appendChild(actionRow);

    if (!signedIn) {
      // Manual fallback: paste the redirected URL (or code) back into the app.
      const manualWrap = document.createElement('details');
      manualWrap.className = 'settings-details';
      const manualSummary = document.createElement('summary');
      manualSummary.textContent = 'Paste redirect result (manual fallback)';
      manualWrap.appendChild(manualSummary);

      const manualRow = document.createElement('div');
      manualRow.className = 'settings-row';
      const manualInput = document.createElement('input');
      manualInput.className = 'settings-input';
      manualInput.placeholder = 'https://…/?code=…&state=…';
      const manualBtn = document.createElement('button');
      manualBtn.className = 'btn btn--secondary';
      manualBtn.textContent = 'Complete sign-in';
      manualBtn.addEventListener('click', async () => {
        manualBtn.disabled = true;
        try {
          this.settings.set({ authMode: 'oidc' });
          auth.applyConfig();
          await auth.completeManual(manualInput.value.trim());
          this.render();
        } catch (e) {
          manualBtn.disabled = false;
          status.className = 'account-status account-status--out';
          status.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`;
        }
      });
      manualRow.appendChild(manualInput);
      manualRow.appendChild(manualBtn);
      manualWrap.appendChild(manualRow);
      section.appendChild(manualWrap);
    }

    // Advanced OIDC config.
    const adv = document.createElement('details');
    adv.className = 'settings-details';
    const advSummary = document.createElement('summary');
    advSummary.textContent = 'Advanced (issuer / client / scope)';
    adv.appendChild(advSummary);
    adv.appendChild(
      this.makeTextRow('OIDC Issuer', 'oidcIssuer', cfg.oidcIssuer, {
        hint: 'CI-Portal base URL, e.g. https://hub.ci.computer/api/auth',
        onChange: () => auth.applyConfig(),
      })
    );
    adv.appendChild(
      this.makeTextRow('Client ID', 'oidcClientId', cfg.oidcClientId, {
        hint: 'Public OIDC client (default: ci-hub)',
        onChange: () => auth.applyConfig(),
      })
    );
    adv.appendChild(
      this.makeTextRow('Scope', 'oidcScope', cfg.oidcScope, {
        hint: 'Space-separated; offline_access enables refresh tokens',
        onChange: () => auth.applyConfig(),
      })
    );
    section.appendChild(adv);

    return section;
  }

  /**
   * CI-Hub quick-connect. Enter the Hub base host once, then one tap fills in
   * the standardized backend URL / kind / model for Ollama, Hermes, or
   * OpenClaw (see config/HubPresets.ts).
   */
  private makeHubSection(): HTMLElement {
    const cfg = this.settings.get();
    const section = this.makeSection('CI-Hub');

    section.appendChild(
      this.makeTextRow('Hub Base URL', 'hubBaseUrl', cfg.hubBaseUrl, {
        hint: 'Host of your CI-Hub, e.g. http://ci-hub.local or a Tailscale IP',
        placeholder: 'http://ci-hub.local',
      })
    );

    const row = document.createElement('div');
    row.className = 'settings-row';
    const label = document.createElement('div');
    label.className = 'settings-row__label';
    label.textContent = 'Quick connect';
    row.appendChild(label);
    const hint = document.createElement('div');
    hint.className = 'settings-row__hint';
    hint.textContent =
      'Fills Backend URL / Kind / Model from the Hub host above. Edit the model after if needed.';
    row.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'kind-picker';
    for (const preset of hubPresets(cfg.hubBaseUrl)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'kind-card';
      const name = document.createElement('div');
      name.className = 'kind-card__name';
      name.textContent = preset.label;
      const h = document.createElement('div');
      h.className = 'kind-card__hint';
      h.textContent = preset.hint;
      card.appendChild(name);
      card.appendChild(h);
      card.addEventListener('click', () => {
        this.applyHubService(preset.service);
      });
      grid.appendChild(card);
    }
    row.appendChild(grid);
    section.appendChild(row);
    return section;
  }

  private applyHubService(service: HubService): void {
    const cfg = this.settings.get();
    const preset = hubPresets(cfg.hubBaseUrl).find((p) => p.service === service);
    if (!preset) return;
    this.settings.set(preset.patch);
    this.adapter.updateConfig(this.settings.get());
    this.render();
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

  /**
   * Visual card-picker for the backend kind — clearer than a dropdown for
   * a discrete, branded set of choices, and shows the per-kind hint inline.
   */
  private makeKindPicker(active: BackendConfig['backendKind']): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'settings-row__label';
    labelEl.textContent = 'Backend Kind';
    row.appendChild(labelEl);

    const hint = document.createElement('div');
    hint.className = 'settings-row__hint';
    hint.textContent =
      'Tells the app which agent runs behind Backend URL. Hub-routed kinds also unlock permission prompts on the HUD.';
    row.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'kind-picker';

    const KINDS: Array<{
      value: BackendConfig['backendKind'];
      name: string;
      hint: string;
    }> = [
      { value: 'local-llm',  name: 'Local LLM',   hint: 'Ollama / vLLM / Hermes' },
      { value: 'openai',     name: 'OpenAI-like', hint: 'Direct or any provider' },
      { value: 'claude-cli', name: 'Claude Code', hint: 'via agent-hub' },
      { value: 'codex-cli',  name: 'Codex CLI',   hint: 'via agent-hub' },
      { value: 'openclaw',   name: 'OpenClaw',    hint: 'Gateway via agent-hub' },
    ];
    for (const k of KINDS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className =
        'kind-card' + (k.value === active ? ' kind-card--active' : '');

      const name = document.createElement('div');
      name.className = 'kind-card__name';
      name.textContent = k.name;

      const h = document.createElement('div');
      h.className = 'kind-card__hint';
      h.textContent = k.hint;

      card.appendChild(name);
      card.appendChild(h);
      card.addEventListener('click', () => {
        this.settings.set({ backendKind: k.value });
        this.adapter.updateConfig(this.settings.get());
        this.render();
      });
      grid.appendChild(card);
    }

    row.appendChild(grid);
    return row;
  }

  private makeTextRow(
    label: string,
    key: keyof BackendConfig,
    value: string,
    opts: {
      hint?: string;
      placeholder?: string;
      type?: string;
      onChange?: () => void;
    } = {}
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
      opts.onChange?.();
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
