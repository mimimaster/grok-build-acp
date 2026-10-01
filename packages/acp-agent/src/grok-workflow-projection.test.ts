import { describe, expect, it } from 'vitest';
import { projectGrokWorkflow } from './grok-workflow-projection.js';

describe('Grok background workflow projection', () => {
  it('retains interrupted state, phase progress, child failures and explanation', () => {
    const snapshot = projectGrokWorkflow({ version: 4, state: {
      run_id: 'wf_test', name: 'deep-research', objective: 'Research packages', status: 'interrupted', revision: 26,
      current_phase: 'Verify', phases: [{ title: 'Plan' }, { title: 'Research' }, { title: 'Verify' }, { title: 'Report' }],
      history: [{ event: 'phase_entered', detail: 'Plan' }, { event: 'phase_entered', detail: 'Research' }, { event: 'phase_entered', detail: 'Verify' }],
      agents: [{ agent_id: 'child', label: 'verifier', state: 'failed', phase: 'Verify', tokens_used: 0 }],
      pause_message: 'cleanup timed out; start a new run',
    } }, 'product');
    expect(snapshot).toMatchObject({ workflowId: 'wf_test', sessionId: 'product', status: 'interrupted', message: 'cleanup timed out; start a new run', agents: [{ status: 'failed', tokensUsed: 0 }] });
    expect(snapshot?.phases.map((phase) => phase.status)).toEqual(['done', 'done', 'active', 'pending']);
  });
  it('rejects malformed identities, bounds collections and marks completed phases', () => {
    expect(projectGrokWorkflow({ state: { run_id: '../escape', name: 'task', status: 'running' } }, 'p')).toBeUndefined();
    const snapshot = projectGrokWorkflow({ state: { run_id: 'wf_test', name: 'task', status: 'completed', phases: Array.from({ length: 90 }, () => ({ title: 'Phase' })) } }, 'p');
    expect(snapshot?.phases).toHaveLength(64);
    expect(snapshot?.phases.every((phase) => phase.status === 'done')).toBe(true);
  });
});
