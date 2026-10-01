import type { BackendWorkflowSnapshot } from '@piwin/contracts';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === 'string' ? value.slice(0, 4000) : undefined; }
function count(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }

/** Project native versioned state, retaining terminal explanations rather than guessing success. */
export function projectGrokWorkflow(value: unknown, sessionId: string): BackendWorkflowSnapshot | undefined {
  const state = record(record(value).state);
  const workflowId = text(state.run_id);
  const name = text(state.name);
  const status = text(state.status);
  if (!workflowId || !/^wf_[a-zA-Z0-9_-]+$/.test(workflowId) || !name || !status) return undefined;
  const history = (Array.isArray(state.history) ? state.history : []).slice(-64).map((item) => {
    const entry = record(item);
    return { event: text(entry.event) ?? 'unknown', ...(text(entry.detail) ? { detail: text(entry.detail) } : {}), ...(text(entry.at) ? { at: text(entry.at) } : {}) };
  });
  const entered = new Set(history.filter((entry) => entry.event === 'phase_entered').map((entry) => entry.detail));
  const currentPhase = text(state.current_phase);
  const phases: BackendWorkflowSnapshot['phases'] = (Array.isArray(state.phases) ? state.phases : []).slice(0, 64).map((item) => {
    const phase = record(item);
    const title = text(phase.title) ?? 'Phase';
    return { title, ...(typeof phase.detail === 'string' ? { detail: phase.detail.slice(0, 4000) } : {}), status: status === 'completed' ? 'done' : title === currentPhase ? 'active' : entered.has(title) ? 'done' : 'pending' };
  });
  const agents: BackendWorkflowSnapshot['agents'] = (Array.isArray(state.agents) ? state.agents : []).slice(0, 128).map((item) => {
    const entry = record(item);
    const phase = text(entry.phase);
    const tokensUsed = count(entry.tokens_used);
    return { id: text(entry.agent_id) ?? 'unknown', label: text(entry.label) ?? 'Agent', status: text(entry.state) ?? 'unknown', ...(phase ? { phase } : {}), ...(tokensUsed !== undefined ? { tokensUsed } : {}) };
  });
  const message = text(state.pause_message) ?? text(state.error);
  const elapsedMs = count(state.elapsed_ms_floor);
  return { workflowId, sessionId, agentId: 'grok', name, objective: text(state.objective) ?? '', status,
    revision: count(state.revision) ?? 0, phases, agents,
    history: history.map((entry) => ({ event: entry.event, ...(entry.detail !== undefined ? { detail: entry.detail } : {}), ...(entry.at !== undefined ? { at: entry.at } : {}) })),
    reportAvailable: false, ...(currentPhase ? { currentPhase } : {}), ...(message ? { message } : {}), ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}
