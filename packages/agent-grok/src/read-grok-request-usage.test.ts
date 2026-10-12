import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { readGrokRequestUsage } from './read-grok-request-usage.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('native request log reader', () => {
  it('returns newly completed requests on refresh before the enclosing turn ends', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-request-log-'));
    homes.push(home);
    const query = { from: '2026-10-02T05:00:00Z', sessions: [
      { backendSessionId: 'native-1', workingDirectory: '/ws', modelId: 'grok-fast' },
    ] };
    const root = grokSessionOutputRoot({ sessionId: 'product-1', backendSessionId: 'native-1', cwd: '/ws' }, home);
    const logs = join(home, '.grok', 'logs');
    await mkdir(logs, { recursive: true });
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'events.jsonl'), JSON.stringify({ type: 'first_token', ts: '2026-10-02T05:00:01.200Z' }) + '\n');
    const done = (loopIndex: number, ts: string) => JSON.stringify({ ts, sid: 'native-1', pid: 100,
      msg: 'shell.turn.inference_done', ctx: { loop_index: loopIndex, model_elapsed_ms: 2000,
        prompt_tokens: 1000, cached_prompt_tokens: 800, completion_tokens: 100, ttft_ms: null,
      } });
    const path = join(logs, 'unified.jsonl');
    await writeFile(path, done(1, '2026-10-02T05:00:03Z') + '\n');
    const first = await readGrokRequestUsage(query, home);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ firstTokenMs: 200, durationMs: 2000, totalTokens: 1100 });
    await appendFile(path, done(2, '2026-10-02T05:00:06Z') + '\n{"unfinished":');
    const refreshed = await readGrokRequestUsage(query, home);
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]?.requestId).toBe(first[0]?.requestId);
    expect(refreshed[1]?.firstTokenMs).toBeUndefined();
  });

  it('treats missing native logs as unavailable detail', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-no-log-'));
    homes.push(home);
    expect(await readGrokRequestUsage({ from: new Date().toISOString(), sessions: [] }, home)).toEqual([]);
  });
});
