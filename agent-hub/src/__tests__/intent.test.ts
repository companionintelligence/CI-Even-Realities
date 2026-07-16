import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../routing/intent.ts';
import { loadConfig } from '../config.ts';

describe('classifyIntent', () => {
  describe('memory recall (query kept intact)', () => {
    it.each([
      'remember I parked on level 3',
      'What do you know about Ada?',
      'recall my last trip to Berlin',
      'Do you remember my sister’s birthday?',
      'what did I eat yesterday',
    ])('routes %j to memory without stripping', (text) => {
      expect(classifyIntent(text)).toEqual({ kind: 'memory' });
    });

    it('does not match mid-word ("remembering")', () => {
      expect(classifyIntent('remembering is hard').kind).toBe('local-llm');
    });
  });

  describe('explicit agent addresses (prefix stripped)', () => {
    it.each([
      ['ask hermes what time is it', 'hermes', 'what time is it'],
      ['Hermes, check the weather', 'hermes', 'check the weather'],
      ['ask openclaw to list my tasks', 'openclaw', 'to list my tasks'],
      ['OpenClaw, restart the sync job', 'openclaw', 'restart the sync job'],
      ['ask claw status of the gateway', 'openclaw', 'status of the gateway'],
      ['ask claude to refactor Main.ts', 'claude-cli', 'to refactor Main.ts'],
      ['Claude, write a unit test', 'claude-cli', 'write a unit test'],
      ['ask codex fix the flaky test', 'codex-cli', 'fix the flaky test'],
      ['Codex, run the suite', 'codex-cli', 'run the suite'],
    ])('%j → %s with cleaned text', (text, kind, cleanedText) => {
      expect(classifyIntent(text)).toEqual({ kind, cleanedText });
    });

    it('is case-insensitive', () => {
      expect(classifyIntent('ASK HERMES PING')).toEqual({
        kind: 'hermes',
        cleanedText: 'PING',
      });
    });

    it('tolerates leading whitespace', () => {
      expect(classifyIntent('  ask hermes what time is it')).toEqual({
        kind: 'hermes',
        cleanedText: 'what time is it',
      });
    });

    it('a bare address strips to nothing → no cleanedText', () => {
      expect(classifyIntent('ask hermes')).toEqual({ kind: 'hermes' });
    });

    it('does not strip a lookalike word ("ask clawhammer …")', () => {
      expect(classifyIntent('ask clawhammer a question').kind).toBe('local-llm');
    });
  });

  describe('default', () => {
    it.each(['what time is it', 'tell me a joke', 'hermes is a greek god'])(
      'routes %j to local-llm',
      (text) => {
        expect(classifyIntent(text)).toEqual({ kind: 'local-llm' });
      }
    );
  });
});

describe('config AGENT_KIND=auto', () => {
  it('loadConfig accepts auto as the default kind', () => {
    expect(loadConfig({ AGENT_KIND: 'auto' }).agentKind).toBe('auto');
  });

  it('still rejects unknown kinds', () => {
    expect(loadConfig({ AGENT_KIND: 'nonsense' }).agentKind).toBe('openai');
  });
});
