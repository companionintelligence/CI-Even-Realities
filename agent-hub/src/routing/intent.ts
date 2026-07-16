/**
 * intent.ts
 *
 * Deterministic utterance → backend classifier behind the virtual 'auto'
 * kind. One assistant instead of modes: the wearer just speaks, and the
 * router picks the registered target from the utterance itself.
 *
 * v1 is rule-based on purpose — deterministic, sub-millisecond, and unit
 * testable with no model in the loop. An Ollama-backed classifier can slot
 * in later behind this same function signature (classifyIntent stays the
 * single entry point; only its body changes).
 */

import type { BackendKind } from '../adapters/Adapter.ts';

export interface IntentResult {
  /** Backend the utterance should be routed to. */
  kind: BackendKind;
  /**
   * Set when an explicit address prefix ("ask hermes …") was stripped; the
   * routed adapter should see this text instead of the raw utterance. Left
   * unset for memory recall (the query IS the utterance) and for bare
   * addresses that strip to nothing.
   */
  cleanedText?: string;
}

interface IntentRule {
  /** Target backend when one of the patterns matches. */
  kind: BackendKind;
  /** Anchored, case-insensitive prefix patterns, tried in order. */
  patterns: RegExp[];
  /** Strip the matched prefix from the forwarded text (explicit addresses). */
  strip?: boolean;
}

/**
 * Rule table — first match wins, top to bottom. Data-driven so new targets
 * are one entry, not new code.
 */
const RULES: IntentRule[] = [
  // Memory recall — the whole utterance is the recall query; nothing stripped.
  {
    kind: 'memory',
    patterns: [
      /^remember\s/i,
      /^what do you know\b/i,
      /^recall\s/i,
      /^do you remember\b/i,
      /^what did i\b/i,
    ],
  },
  // Explicit agent addresses — the address prefix is stripped before forwarding.
  {
    kind: 'hermes',
    strip: true,
    patterns: [/^ask\s+hermes\b[,:]?\s*/i, /^hermes,\s*/i],
  },
  {
    kind: 'openclaw',
    strip: true,
    patterns: [
      /^ask\s+openclaw\b[,:]?\s*/i,
      /^openclaw,\s*/i,
      /^ask\s+claw\b[,:]?\s*/i,
    ],
  },
  {
    kind: 'claude-cli',
    strip: true,
    patterns: [/^ask\s+claude\b[,:]?\s*/i, /^claude,\s*/i],
  },
  {
    kind: 'codex-cli',
    strip: true,
    patterns: [/^ask\s+codex\b[,:]?\s*/i, /^codex,\s*/i],
  },
];

/**
 * Classify one utterance. Pure and deterministic: same text in, same result
 * out. Unmatched utterances default to the local LLM — general chat is the
 * common case on the glasses.
 */
export function classifyIntent(text: string): IntentResult {
  const trimmed = text.trim();
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      if (!rule.strip) return { kind: rule.kind };
      const cleaned = trimmed.slice(match[0].length).trim();
      // A bare address ("ask hermes") strips to nothing — forward as-is.
      return cleaned ? { kind: rule.kind, cleanedText: cleaned } : { kind: rule.kind };
    }
  }
  return { kind: 'local-llm' };
}
