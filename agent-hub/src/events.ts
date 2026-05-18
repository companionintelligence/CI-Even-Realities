/**
 * events.ts
 *
 * AgentEvent union — the wire-internal event type emitted by adapters and
 * serialised to SSE by the router. Mirrors the glasses-app type but lives in
 * its own file to keep the hub self-contained (no cross-package imports).
 */

export interface PromptOption {
  id: string;
  label: string;
}

export type AgentStatusKind =
  | 'thinking'
  | 'executing'
  | 'awaiting_input'
  | 'done';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'agent_status'; kind: AgentStatusKind; label?: string }
  | {
      type: 'permission_prompt';
      id: string;
      tool: string;
      summary: string;
      options: PromptOption[];
    }
  | { type: 'error'; message: string };

/** Stable, ordered pair of approve/deny option ids. */
export const DEFAULT_PROMPT_OPTIONS: PromptOption[] = [
  { id: 'approve', label: 'Approve' },
  { id: 'deny', label: 'Deny' },
];
