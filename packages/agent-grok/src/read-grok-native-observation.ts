import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { GrokSessionOptionsState } from '@piwin/acp-agent';
import type { AgentEvent, AgentPluginNativeObservation } from '@piwin/contracts';
import { GrokNotificationRouter } from './grok-notification-router.js';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { attachGrokMediaProposal } from './grok-media-proposal.js';
import { readGrokNativeFile } from './read-grok-native-file.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function parse(line: string): Record<string, unknown> | undefined {
  try { return record(JSON.parse(line)); } catch { return undefined; }
}

/** Real native turn state comes from session telemetry; ACP catalogs only describe their own resident actors. */
export function projectGrokNativeActivity(lines: readonly string[]): AgentPluginNativeObservation['activity'] {
  let activity: AgentPluginNativeObservation['activity'] = 'unknown';
  for (const line of lines) {
    const event = parse(line);
    if (event?.type === 'turn_started') activity = 'running';
    else if (event?.type === 'turn_ended') activity = 'idle';
    else if (event?.type === 'permission_requested' || event?.type === 'phase_changed' && event.phase === 'permission_prompt') activity = 'waiting';
    else if (event?.type === 'permission_resolved' || event?.type === 'phase_changed') activity = 'running';
  }
  return activity;
}

/** Reads the native session's files only. Never spawns Grok, loads a session, cancels or writes its files. */
export async function readGrokNativeObservation(value: unknown, home = homedir()): Promise<AgentPluginNativeObservation> {
  const input = record(value);
  if (!input || Object.keys(input).some((key) => !['backendSessionId', 'workingDirectory', 'includeHistory'].includes(key)) ||
      typeof input.backendSessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.backendSessionId) ||
      typeof input.workingDirectory !== 'string' || input.workingDirectory.length > 4096 || !isAbsolute(input.workingDirectory) || input.workingDirectory.includes('\0') ||
      (input.includeHistory !== undefined && typeof input.includeHistory !== 'boolean')) throw new Error('invalid-native-observation-query');
  const context = { sessionId: input.backendSessionId, backendSessionId: input.backendSessionId, cwd: input.workingDirectory };
  const root = grokSessionOutputRoot(context, home);
  const telemetry = (await readGrokNativeFile(join(root, 'events.jsonl'), 1024 * 1024, true) ?? '').split('\n');
  const summary = parse(await readGrokNativeFile(join(root, 'summary.json'), 256 * 1024) ?? '');
  const title = typeof summary?.generated_title === 'string' ? summary.generated_title.trim() : undefined;
  const times = telemetry.map((line) => parse(line)?.ts).filter((time): time is string => typeof time === 'string').map(Date.parse).filter(Number.isFinite);
  if (typeof summary?.updated_at === 'string') times.push(Date.parse(summary.updated_at));
  const lastChangeUnixMs = Math.max(...times.filter(Number.isFinite));
  const result: AgentPluginNativeObservation = {
    backendSessionId: input.backendSessionId, activity: projectGrokNativeActivity(telemetry),
    ...(title ? { title } : {}), ...(Number.isFinite(lastChangeUnixMs) ? { lastChangeUnixMs } : {}),
  };
  if (input.includeHistory !== true) return result;
  const history = await readGrokNativeFile(join(root, 'updates.jsonl'), 16 * 1024 * 1024, true);
  if (history === undefined) throw new Error('native-history-unavailable');
  const updates = history.split('\n');
  const events: AgentEvent[] = [];
  const router = new GrokNotificationRouter(new GrokSessionOptionsState(), {
    emitAll: () => undefined, onTitle: () => undefined, publishOptions: () => undefined,
  });
  router.beginReplay(events);
  for (const line of updates) {
    const update = parse(line);
    if (typeof update?.method === 'string') router.handle(update.method, update.params, input.backendSessionId);
  }
  router.endReplay();
  const emissions = events.map((event) => {
    const prepared = attachGrokMediaProposal(event, context);
    return { type: 'agent' as const, event: prepared.event, ...(prepared.media ? { media: prepared.media } : {}) };
  });
  // Keep complete recent user turns within the plugin frame ceiling. Native history remains authoritative.
  while (Buffer.byteLength(JSON.stringify(emissions), 'utf8') > 1400 * 1024 && emissions.length > 0) {
    const nextUser = emissions.findIndex((emission, index) => index > 0 && emission.event.type === 'message/start' && emission.event.role === 'user');
    if (nextUser < 0) throw new Error('native-history-turn-exceeds-frame-limit');
    emissions.splice(0, nextUser);
  }
  result.replayEvents = emissions;
  return result;
}
