import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { projectGrokNativeActivity, readGrokNativeObservation } from './read-grok-native-observation.js';

it('observes complete native turns and human waits rather than inference request completion', () => {
  const rows = (events: object[]) => events.map((event) => JSON.stringify(event));
  expect(projectGrokNativeActivity(rows([{ type: 'turn_started' }, { type: 'first_token' }, { type: 'tool_completed' }]))).toBe('running');
  expect(projectGrokNativeActivity(rows([{ type: 'turn_started' }, { type: 'permission_requested' }]))).toBe('waiting');
  expect(projectGrokNativeActivity(rows([{ type: 'permission_requested' }, { type: 'permission_resolved' }]))).toBe('running');
  expect(projectGrokNativeActivity(rows([{ type: 'turn_started' }, { type: 'turn_ended', outcome: 'interrupted' }]))).toBe('idle');
  expect(projectGrokNativeActivity(['{partial'])).toBe('unknown');
});

it('reads title, activity and normalized user/assistant history without an ACP process', async () => {
  const home = await mkdtemp(join(tmpdir(), 'grok-native-observe-'));
  const input = { backendSessionId: 'native-1', workingDirectory: '/project', includeHistory: true };
  const root = grokSessionOutputRoot({ sessionId: 'native-1', backendSessionId: 'native-1', cwd: '/project' }, home);
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'summary.json'), JSON.stringify({ generated_title: 'Native title', updated_at: '2026-10-12T10:00:00Z' }));
    await writeFile(join(root, 'events.jsonl'), JSON.stringify({ type: 'turn_started', ts: '2026-10-12T10:00:01Z' }));
    await writeFile(join(root, 'updates.jsonl'), [
      { method: 'session/update', params: { sessionId: 'native-1', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix sidebar' } } } },
      { method: 'session/update', params: { sessionId: 'native-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working on it' } } } },
    ].map((row) => JSON.stringify(row)).join('\n'));
    const observed = await readGrokNativeObservation(input, home);
    expect(observed).toMatchObject({ title: 'Native title', activity: 'running', lastChangeUnixMs: Date.parse('2026-10-12T10:00:01Z') });
    expect(observed.replayEvents).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'message/text_delta', delta: 'Fix sidebar' }) }));
    expect(observed.replayEvents).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'message/text_delta', delta: 'Working on it' }) }));
    await expect(readGrokNativeObservation({ ...input, backendSessionId: '../escape' }, home)).rejects.toThrow('invalid-native');
  } finally { await rm(home, { recursive: true, force: true }); }
});

it('reports unavailable history rather than claiming a successful empty snapshot', async () => {
  const home = await mkdtemp(join(tmpdir(), 'grok-native-missing-'));
  try {
    await expect(readGrokNativeObservation({ backendSessionId: 'native-1', workingDirectory: '/project', includeHistory: true }, home)).rejects.toThrow('native-history-unavailable');
  } finally { await rm(home, { recursive: true, force: true }); }
});
