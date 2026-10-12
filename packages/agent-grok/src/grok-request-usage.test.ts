import { describe, expect, it } from 'vitest';
import { projectGrokRequestUsage, parseGrokFirstTokenTimes } from './grok-request-usage.js';

const query = { from: '2026-10-02T05:00:00Z', sessions: [
  { backendSessionId: 'native-1', workingDirectory: '/ws', modelId: 'grok-4.7' },
] };
const inference = (timestamp: string, overrides: Record<string, unknown> = {}) => JSON.stringify({
  sid: 'native-1', pid: 100, ts: timestamp, msg: 'shell.turn.inference_done', ctx: {
    loop_index: 1, model_elapsed_ms: 2000, prompt_tokens: 1000,
    cached_prompt_tokens: 800, completion_tokens: 100, ...overrides,
  },
});

describe('Grok native model request accounting', () => {
  it('keeps distinct calls during an unfinished turn and uses native token accounting', () => {
    const rows = projectGrokRequestUsage([
      inference('2026-10-02T05:00:03.000Z'),
      inference('2026-10-02T05:00:06.000Z', { loop_index: 2 }),
    ], query, new Map([['native-1', [Date.parse('2026-10-02T05:00:01.500Z')]]]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ promptTokens: 200, cacheReadTokens: 800,
      completionTokens: 100, totalTokens: 1100, durationMs: 2000, firstTokenMs: 500 });
    expect(rows[1]?.firstTokenMs).toBeUndefined();
    expect(rows[0]?.requestId).not.toBe(rows[1]?.requestId);
  });

  it('keeps current native model selection, ignores foreign/old/malformed records and deduplicates', () => {
    const done = inference('2026-10-02T05:00:03.000Z');
    const rows = projectGrokRequestUsage([
      'not json', inference('2026-10-02T04:00:00Z'),
      JSON.stringify({ sid: 'native-1', msg: 'model changed', ctx: { model: 'grok-fast', api_key: 'secret' } }),
      done, done, done.replace('native-1', 'native-other'),
    ], query);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.modelId).toBe('grok-fast');
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('retains reported TTFT when valid and never guesses missing token counts', () => {
    const rows = projectGrokRequestUsage([
      inference('2026-10-02T05:00:03.000Z', { ttft_ms: 250 }),
      inference('2026-10-02T05:00:06.000Z', { completion_tokens: null }),
    ], query);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstTokenMs).toBe(250);
    expect(parseGrokFirstTokenTimes(['broken', JSON.stringify({ type: 'first_token', ts: '2026-10-02T05:00:01Z' })]))
      .toEqual([Date.parse('2026-10-02T05:00:01Z')]);
  });
});
