import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { projectGrokWorkflow } from '@piwin/acp-agent';
import type { BackendWorkflowSnapshot } from '@piwin/contracts';
import { grokSessionOutputRoot, type GrokOutputContext } from './grok-output-context.js';

/** Read Grok's own workflow files. This is not a Host command and does not import media. */
export async function readGrokWorkflows(context: GrokOutputContext): Promise<BackendWorkflowSnapshot[]> {
  const root = grokSessionOutputRoot(context);
  const workflows: BackendWorkflowSnapshot[] = [];
  for (const id of await listWorkflowIds(root)) {
    const raw = await readBoundedFile(root, `workflows/${id}/state.json`, 128 * 1024);
    if (!raw) continue;
    const snapshot = projectGrokWorkflow(JSON.parse(raw) as unknown, context.sessionId);
    if (!snapshot || snapshot.workflowId !== id) continue;
    const report = await readBoundedFile(root, `workflows/${id}/scratch/report.md`, 256 * 1024);
    workflows.push({ ...snapshot, reportAvailable: Boolean(report?.trim()) });
  }
  return workflows;
}

export async function readGrokWorkflowReport(context: GrokOutputContext, workflowId: string): Promise<string | undefined> {
  if (!/^wf_[a-zA-Z0-9_-]+$/.test(workflowId)) return undefined;
  const text = await readBoundedFile(grokSessionOutputRoot(context), `workflows/${workflowId}/scratch/report.md`, 256 * 1024);
  return text?.trim() ? text : undefined;
}

async function listWorkflowIds(root: string): Promise<string[]> {
  try {
    const realRoot = await realpath(root);
    const directory = await realpath(resolve(root, 'workflows'));
    if (!directory.startsWith(realRoot + sep)) throw new Error('workflow directory escapes session root');
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^wf_[a-zA-Z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name).sort().reverse().slice(0, 8);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function readBoundedFile(root: string, relativePath: string, maxBytes: number): Promise<string | undefined> {
  const target = resolve(root, relativePath);
  if (!target.startsWith(resolve(root) + sep)) throw new Error('workflow path escapes session root');
  try {
    const realRoot = await realpath(root);
    const realTarget = await realpath(target);
    if (!realTarget.startsWith(realRoot + sep)) throw new Error('workflow symlink escapes session root');
    const handle = await open(realTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size > maxBytes) throw new Error('workflow file exceeds read limit');
      const bytes = Buffer.alloc(details.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
