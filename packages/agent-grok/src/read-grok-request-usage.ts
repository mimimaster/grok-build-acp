import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentPluginRequestUsage, AgentPluginRequestUsageQuery } from '@piwin/contracts';
import { parseGrokFirstTokenTimes, projectGrokRequestUsage } from './grok-request-usage.js';
import { grokSessionOutputRoot } from './grok-output-context.js';
import { discoverGrokUsageSessions } from './grok-usage-session-tree.js';
import { readGrokNativeFile } from './read-grok-native-file.js';

const MAX_LOG_BYTES = 16 * 1024 * 1024;

/** Data-only native accounting query. Never starts Grok or reads credentials. */
export async function readGrokRequestUsage(
  query: AgentPluginRequestUsageQuery,
  home = homedir(),
): Promise<AgentPluginRequestUsage[]> {
  const { sessions, owners } = await discoverGrokUsageSessions(query.sessions, home);
  const lines = (await readGrokNativeFile(join(home, '.grok', 'logs', 'unified.jsonl'), MAX_LOG_BYTES, true) ?? '').split('\n');
  const firstTokens = new Map<string, readonly number[]>();
  await Promise.all(sessions.map(async (session) => {
    const root = grokSessionOutputRoot({ sessionId: session.backendSessionId,
      backendSessionId: session.backendSessionId, cwd: session.workingDirectory }, home);
    const events = (await readGrokNativeFile(join(root, 'events.jsonl'), MAX_LOG_BYTES, true) ?? '').split('\n');
    firstTokens.set(session.backendSessionId, parseGrokFirstTokenTimes(events));
  }));
  return projectGrokRequestUsage(lines, { ...query, sessions }, firstTokens, owners);
}
