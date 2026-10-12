import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { AgentPluginRequestUsageQuery } from '@piwin/contracts';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { readGrokNativeFile } from './read-grok-native-file.js';

type UsageSession = AgentPluginRequestUsageQuery['sessions'][number];
const MAX_SESSION_ROOTS = 512;
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

/** Only explicit native parent/child metadata can attribute a child to a Host-bound session. */
export async function discoverGrokUsageSessions(bound: readonly UsageSession[], home: string): Promise<{
  sessions: UsageSession[]; owners: ReadonlyMap<string, string>;
}> {
  const sessions = [...bound];
  const owners = new Map(bound.map((session) => [session.backendSessionId, session.backendSessionId]));
  for (let index = 0; index < sessions.length && index < MAX_SESSION_ROOTS; index += 1) {
    const parent = sessions[index];
    if (!parent) continue;
    const root = grokSessionOutputRoot({ sessionId: parent.backendSessionId,
      backendSessionId: parent.backendSessionId, cwd: parent.workingDirectory }, home);
    for (const id of await listChildDirectories(join(root, 'subagents'))) {
      if (!SAFE_SESSION_ID.test(id)) continue;
      const raw = await readGrokNativeFile(join(root, 'subagents', id, 'meta.json'), 256 * 1024);
      const child = parseChild(raw, parent.backendSessionId);
      if (!child || owners.has(child.backendSessionId) || sessions.length >= MAX_SESSION_ROOTS) continue;
      owners.set(child.backendSessionId, owners.get(parent.backendSessionId) ?? parent.backendSessionId);
      sessions.push(child);
    }
  }
  return { sessions, owners };
}

async function listChildDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function parseChild(raw: string | undefined, parentSessionId: string): UsageSession | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const meta = value as Record<string, unknown>;
  if (meta.parent_session_id !== parentSessionId || typeof meta.child_session_id !== 'string'
    || !SAFE_SESSION_ID.test(meta.child_session_id) || typeof meta.child_cwd !== 'string'
    || !isAbsolute(meta.child_cwd)) return undefined;
  return { backendSessionId: meta.child_session_id, workingDirectory: meta.child_cwd,
    ...(typeof meta.effective_model_id === 'string' && meta.effective_model_id.length > 0
      ? { modelId: meta.effective_model_id } : {}),
  };
}
