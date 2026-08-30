/**
 * StatusBar.ts
 *
 * Renders the status bar at the top of the UI, showing:
 *  - Glasses connection state (connected / disconnected)
 *  - Microphone state (idle / recording / processing)
 *  - Current model name
 */

import type { EvenAppBridge, DeviceStatus } from '@evenrealities/even_hub_sdk';
import { DeviceConnectType } from '@evenrealities/even_hub_sdk';

export type AppStatus =
  | 'disconnected'
  | 'connected'
  | 'recording'
  | 'processing'
  | 'thinking';

export class StatusBar {
  private el: HTMLElement;
  private indicator: HTMLElement;
  private textEl: HTMLElement;
  private modelEl: HTMLElement;
  private hudEl: HTMLElement;
  private status: AppStatus = 'disconnected';
  private modelName = '';

  constructor(private container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'status-bar';

    this.indicator = document.createElement('div');
    this.indicator.className = 'status-bar__indicator';

    this.textEl = document.createElement('span');
    this.textEl.className = 'status-bar__text';

    this.modelEl = document.createElement('span');
    this.modelEl.className = 'status-bar__model';

    this.hudEl = document.createElement('span');
    this.hudEl.className = 'status-bar__hud-warning';
    this.hudEl.textContent = '⚠ HUD';
    this.hudEl.title = "Glasses display isn't updating — phone chat still works";
    this.hudEl.style.display = 'none';

    this.el.appendChild(this.indicator);
    this.el.appendChild(this.textEl);
    this.el.appendChild(this.hudEl);
    this.el.appendChild(this.modelEl);
    this.container.appendChild(this.el);

    this.render();
  }

  setModel(model: string): void {
    this.modelName = model;
    this.render();
  }

  setStatus(status: AppStatus): void {
    this.status = status;
    this.render();
  }

  /**
   * Toggle a quiet "glasses display isn't updating" indicator, independent
   * of the main connection/activity status — a HUD write can keep failing
   * (or keep succeeding again) mid-turn without the app's overall status
   * changing.
   */
  setHudDegraded(degraded: boolean): void {
    this.hudEl.style.display = degraded ? '' : 'none';
  }

  /** Connect to the Even Hub SDK to track device connection state. */
  connectBridge(bridge: EvenAppBridge): void {
    bridge.onDeviceStatusChanged((deviceStatus: DeviceStatus) => {
      if (
        deviceStatus.connectType === DeviceConnectType.Connected
      ) {
        if (!this.isInActiveState()) {
          this.setStatus('connected');
        }
      } else {
        if (!this.isInActiveState()) {
          this.setStatus('disconnected');
        }
      }
    });
  }

  private isInActiveState(): boolean {
    const activeStates: AppStatus[] = ['recording', 'processing', 'thinking'];
    return activeStates.includes(this.status);
  }

  private render(): void {
    const labels: Record<AppStatus, string> = {
      disconnected: 'Glasses not connected',
      connected: 'Connected',
      recording: '🎙 Recording...',
      processing: '⏳ Transcribing...',
      thinking: '🤔 Thinking...',
    };

    const indicatorClass: Record<AppStatus, string> = {
      disconnected: '',
      connected: 'status-bar__indicator--connected',
      recording: 'status-bar__indicator--recording',
      processing: 'status-bar__indicator--processing',
      thinking: 'status-bar__indicator--processing',
    };

    this.indicator.className = `status-bar__indicator ${indicatorClass[this.status]}`.trim();
    this.textEl.textContent = labels[this.status];
    this.modelEl.textContent = this.modelName;
  }
}
