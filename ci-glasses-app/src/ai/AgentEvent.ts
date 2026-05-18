/**
 * AgentEvent.ts
 *
 * Structured events emitted by the agent-hub over SSE alongside the standard
 * OpenAI text deltas. See `architecture.md` §3 for the wire contract.
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
