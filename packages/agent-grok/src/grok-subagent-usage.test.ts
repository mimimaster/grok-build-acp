import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { readGrokRequestUsage } from './read-grok-request-usage.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'grok-subagent-usage-'));
  homes.push(home);
  const sessionRoot = (id: string, cwd: string) => grokSessionOutputRoot({ sessionId: id, backendSessionId: id, cwd }, home);
  const link = async (parent: string, cwd: string, child: string, childCwd: string, actualParent = parent) => {
    const directory = join(sessionRoot(parent, cwd), 'subagents', child);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'meta.json'), JSON.stringify({ parent_session_id: actualParent,
      child_session_id: child, child_cwd: childCwd, effective_model_id: 'model-' + child,
      prompt: 'private user content', auth_token: 'private-secret',
    }));
  };
  await link('parent-1', '/ws', 'child-1', '/tree');
  await link('child-1', '/tree', 'grandchild-1', '/tree2');
  await link('parent-1', '/ws', 'foreign-1', '/other', 'unrelated-parent');
  const logs = join(home, '.grok', 'logs');
  await mkdir(logs, { recursive: true });
  const rows = ['parent-1', 'child-1', 'grandchild-1', 'foreign-1'].map((sid) => JSON.stringify({
    sid, pid: 100, ts: '2026-10-02T05:00:03Z', msg: 'shell.turn.inference_done', ctx: {
      loop_index: 1, model_elapsed_ms: 2000, prompt_tokens: 100, completion_tokens: 20, ttft_ms: 300,
    },
  }));
  await writeFile(join(logs, 'unified.jsonl'), rows.join('\n') + '\n');
  return { home, query: { from: '2026-10-02T05:00:00Z', sessions: [
    { backendSessionId: 'parent-1', workingDirectory: '/ws', modelId: 'model-parent' },
  ] } };
}

it('includes recursive native subagent calls under their verified bound parent without exposing metadata', async () => {
  const { home, query } = await fixture();
  const rows = await readGrokRequestUsage(query, home);
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.backendSessionId === 'parent-1')).toBe(true);
  expect(rows.map((row) => row.modelId)).toEqual(['model-parent', 'model-child-1', 'model-grandchild-1']);
  expect(new Set(rows.map((row) => row.requestId)).size).toBe(3);
  expect(JSON.stringify(rows)).not.toContain('private');
});

it('preserves a child session directly bound by Host as its own owner', async () => {
  const { home, query } = await fixture();
  query.sessions.push({ backendSessionId: 'child-1', workingDirectory: '/tree', modelId: 'bound-child-model' });
  const rows = await readGrokRequestUsage(query, home);
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.backendSessionId)).toEqual(['parent-1', 'child-1', 'child-1']);
});
