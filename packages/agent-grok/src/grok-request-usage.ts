import type { AgentPluginRequestUsage, AgentPluginRequestUsageQuery } from '@piwin/contracts';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Whitelist accounting fields only; log messages/context can contain user content. */
export function projectGrokRequestUsage(
  lines: readonly string[],
  query: AgentPluginRequestUsageQuery,
  firstTokenTimes: ReadonlyMap<string, readonly number[]> = new Map(),
  ownerSessionIds: ReadonlyMap<string, string> = new Map(),
): AgentPluginRequestUsage[] {
  const sessions = new Map(query.sessions.map((session) => [session.backendSessionId, session]));
  const models = new Map<string, string>();
  const requests = new Map<string, AgentPluginRequestUsage>();
  const fromMs = Date.parse(query.from);
  if (!Number.isFinite(fromMs)) return [];
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const entry = record(value);
    if (!entry || typeof entry.sid !== 'string') continue;
    const session = sessions.get(entry.sid);
    if (!session) continue;
    const context = record(entry.ctx);
    if (entry.msg === 'model changed' && typeof context?.model === 'string') {
      models.set(entry.sid, context.model);
    }
    if (entry.msg !== 'shell.turn.inference_done' || typeof entry.ts !== 'string') continue;
    const endedMs = Date.parse(entry.ts);
    if (!Number.isFinite(endedMs) || endedMs < fromMs) continue;
    const promptTokens = number(context?.prompt_tokens);
    const completionTokens = number(context?.completion_tokens);
    const durationMs = number(context?.model_elapsed_ms);
    const loopIndex = number(context?.loop_index);
    const processId = number(entry.pid);
    if (promptTokens === undefined || completionTokens === undefined || durationMs === undefined
      || loopIndex === undefined || processId === undefined) continue;
    const cachedTokens = number(context?.cached_prompt_tokens);
    const cacheReadTokens = cachedTokens !== undefined ? Math.min(cachedTokens, promptTokens) : undefined;
    const reportedFirstTokenMs = number(context?.ttft_ms);
    const startedMs = endedMs - durationMs;
    const firstTokenAt = firstTokenTimes.get(entry.sid)?.find((at) => at >= startedMs && at <= endedMs);
    const firstTokenMs = reportedFirstTokenMs ?? (firstTokenAt !== undefined ? firstTokenAt - startedMs : undefined);
    const modelId = models.get(entry.sid) ?? session.modelId;
    const requestId = `${entry.sid}:${processId}:${loopIndex}:${entry.ts}`;
    requests.set(requestId, {
      requestId, backendSessionId: ownerSessionIds.get(entry.sid) ?? entry.sid,
      ...(modelId !== undefined ? { modelId } : {}),
      promptTokens: Math.max(0, promptTokens - (cacheReadTokens ?? 0)), completionTokens,
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      totalTokens: promptTokens + completionTokens,
      durationMs,
      ...(firstTokenMs !== undefined && firstTokenMs <= durationMs ? { firstTokenMs } : {}),
      recordedAt: entry.ts, timingScope: 'request',
    });
  }
  return [...requests.values()];
}

export function parseGrokFirstTokenTimes(lines: readonly string[]): number[] {
  const times: number[] = [];
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const event = record(value);
    if (event?.type !== 'first_token' || typeof event.ts !== 'string') continue;
    const at = Date.parse(event.ts);
    if (Number.isFinite(at)) times.push(at);
  }
  return times.sort((left, right) => left - right);
}
