import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  AcpClient,
  GROK_DROPPED_NOTIFICATION_METHODS,
  JsonRpcConnection,
  projectGrokCatalogEntry,
  projectGrokMcpStatus,
} from '@piwin/acp-agent';
import {
  formatError,
  parseAgentPluginFrame,
  type AgentEvent,
  type AgentPluginEmission,
  type AgentPluginFrame,
  type AgentPluginMethod,
  type AgentPluginPermissionDecision,
  type AgentPluginRequestUsageQuery,
  type AgentPluginScope,
  type BackendRunIntervention,
  type ExternalAgentMcpServerStatus,
  type PromptInput,
} from '@piwin/contracts';
import { createGrokSessionCapabilities } from './grok-capabilities.js';
import { detectGrokCli } from './grok-cli-detection.js';
import { attachGrokMediaProposal } from './grok-media-proposal.js';
import { createGrokProcessTransport } from './grok-process-transport.js';
import { GrokSessionHandle, type GrokSessionPorts } from './grok-session-handle.js';
import { readGrokWorkflowReport, readGrokWorkflows } from './grok-workflows.js';
import { readGrokRequestUsage } from './read-grok-request-usage.js';
import { readGrokNativeObservation } from './read-grok-native-observation.js';
import { assertReplayFramesFit } from './replay-stream.js';

type PendingCall = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type SessionSlot = {
  scope: Extract<AgentPluginScope, { kind: 'session' }>;
  handle: GrokSessionHandle;
  cwd: string;
  mcp: ExternalAgentMcpServerStatus[];
  mcpObserved: boolean;
  runId?: string;
};

/** One installable adapter process. Vendor ACP stays inside; stdout speaks only the Host protocol. */
export async function serveAgentPlugin(io: {
  input: Readable;
  output: Writable;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = io.env ?? process.env;
  const pending = new Map<string, PendingCall>();
  const slots = new Map<string, SessionSlot>();
  let binaryPath: string | undefined;
  let initialized = false;
  // Set by a Host that collects history from event frames during session/load.
  let replayStreaming = false;
  let stopped = false;
  let writeChain = Promise.resolve();
  const write = (frame: unknown): void => {
    const line = `${JSON.stringify(frame)}\n`;
    writeChain = writeChain.then(() => new Promise((resolve, reject) => {
      io.output.write(line, (error) => error ? reject(error) : resolve());
    }));
  };
  const fail = (frame: Extract<AgentPluginFrame, { kind: 'request' }>, code: 'invalid-request' | 'unavailable' | 'backend-error', message: string): void => {
    write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: false, error: { code, message } });
  };
  const callHost = (scope: AgentPluginScope, method: AgentPluginMethod, params: unknown): Promise<unknown> => {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      write({ protocolVersion: 1, kind: 'request', scope, requestId, method, params });
    });
  };
  const emit = (scope: SessionSlot['scope'], emission: AgentPluginEmission): void => {
    write({ protocolVersion: 1, kind: 'event', scope, emission });
  };
  const lines = createInterface({ input: io.input });
  const done = new Promise<void>((resolve) => {
    lines.on('close', () => resolve());
  });
  lines.on('line', (line) => {
    void handleLine(line).catch((error: unknown) => {
      io.output.emit('error', error instanceof Error ? error : new Error(formatError(error)));
    });
  });
  await done;
  await releaseAll();

  async function handleLine(line: string): Promise<void> {
    if (stopped || line.trim() === '') return;
    const frame = parseAgentPluginFrame(line);
    if (frame.kind === 'response') {
      const waiter = pending.get(frame.requestId);
      pending.delete(frame.requestId);
      if (!waiter) return;
      frame.ok ? waiter.resolve(frame.result) : waiter.reject(new Error(frame.error.message));
      return;
    }
    if (frame.kind !== 'request') return;
    try {
      const result = await dispatch(frame);
      write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: true, result });
      if (frame.method === 'plugin/dispose') stopped = true;
    } catch (error) {
      fail(frame, error instanceof PluginRequestError ? error.code : 'backend-error', formatError(error));
    }
  }

  async function dispatch(frame: Extract<AgentPluginFrame, { kind: 'request' }>): Promise<unknown> {
    if (frame.method === 'plugin/initialize') return initialize(frame.params);
    if (!initialized) throw new PluginRequestError('unavailable', 'plugin is not initialized');
    switch (frame.method) {
      case 'check': return detectGrokCli({ env, ...(binaryPath ? { binaryPath } : {}) });
      case 'catalog/list': return (await withClient(undefined, (client) => client.xaiListSessions())).map(projectGrokCatalogEntry);
      case 'catalog/native-observe': return readGrokNativeObservation(frame.params);
      case 'catalog/usage': return readGrokRequestUsage(frame.params as AgentPluginRequestUsageQuery);
      case 'catalog/rename': return catalogMutate(frame.params, (client, id, title) => client.xaiRenameSession(id, title));
      case 'catalog/delete': return catalogMutate(frame.params, (client, id) => client.xaiDeleteSession(id));
      case 'session/new': return openSession(frame, true);
      case 'session/load': return openSession(frame, false, true);
      case 'session/resume': return openSession(frame, false, false);
      case 'session/prompt': return prompt(frame);
      case 'session/cancel': await requireSlot(frame).handle.abort(); return null;
      case 'session/options': return requireSlot(frame).handle.getBackendOptions();
      case 'session/model': return select(frame, 'model');
      case 'session/effort': return select(frame, 'effort');
      case 'session/mode': return select(frame, 'mode');
      case 'session/commands': return requireSlot(frame).handle.getBackendOptions().commands;
      case 'session/interject': await requireSlot(frame).handle.armRunIntervention(parseIntervention(frame.params)); return null;
      case 'session/interject-cancel': return requireSlot(frame).handle.cancelRunIntervention();
      case 'session/mcp-status': return { servers: requireSlot(frame).mcp, observed: requireSlot(frame).mcpObserved };
      case 'session/workflows': return readGrokWorkflows(outputContext(requireSlot(frame)));
      case 'session/workflow-report': return workflowReport(frame);
      case 'session/release': await release(frame.scope.kind === 'session' ? frame.scope.sessionId : ''); return null;
      case 'plugin/dispose': await releaseAll(); return null;
      default: throw new PluginRequestError('unavailable', 'method is not served by this adapter');
    }
  }

  function initialize(params: unknown): { agentId: 'grok'; protocolVersion: 1; requestUsage: true; nativeObservation: true } {
    const record = asRecord(params);
    const runtime = asRecord(record?.runtime);
    if (record?.agentId !== 'grok' || typeof record.pluginRevision !== 'string' || record.hostProtocolVersion !== 1) {
      throw new PluginRequestError('invalid-request', 'unsupported plugin initialization');
    }
    if (typeof runtime?.binaryPath === 'string') binaryPath = runtime.binaryPath;
    replayStreaming = asRecord(record.hostCapabilities)?.replayStreaming === true;
    initialized = true;
    return { agentId: 'grok', protocolVersion: 1, requestUsage: true, nativeObservation: true };
  }

  async function openSession(frame: Extract<AgentPluginFrame, { kind: 'request' }>, create: boolean, replay = false) {
    if (frame.scope.kind !== 'session') throw new PluginRequestError('invalid-request', 'session scope required');
    const params = asRecord(frame.params);
    const binding = asRecord(params?.binding);
    const cwd = params?.cwd;
    const backendSessionId = typeof binding?.backendSessionId === 'string' ? binding.backendSessionId : undefined;
    if (typeof cwd !== 'string' || cwd.length === 0 || binding?.agentId !== 'grok' || (!create && backendSessionId === undefined)) {
      throw new PluginRequestError('invalid-request', 'invalid session open');
    }
    const path = await requireBinary();
    await release(frame.scope.sessionId);
    const scope = frame.scope;
    const slot: SessionSlot = { scope, handle: undefined as unknown as GrokSessionHandle, cwd, mcp: [], mcpObserved: false };
    const ports: GrokSessionPorts = {
      createTransport: (sessionCwd) => createGrokProcessTransport({ binaryPath: path, cwd: sessionCwd, env }),
      requestPermission: async ({ prompt }) => parseDecision(await callHost(scope, 'permission/request', {
        action: prompt.action, detail: prompt.detail, context: prompt.context, options: prompt.options,
        ...(slot.runId ? { runId: slot.runId } : {}),
      })),
      onOptionsChanged: (options) => emit(scope, { type: 'options', options }),
      onTitle: (title) => emit(scope, { type: 'title', title }),
      onTransportClosed: (reason) => emit(scope, { type: 'closed', reason }),
      getCurrentRunId: () => slot.runId,
      onMcpStatus: (value) => {
        const status = projectGrokMcpStatus(value);
        slot.mcpObserved = true;
        if (!status) return;
        slot.mcp = [...slot.mcp.filter((server) => server.name !== status.name), status];
        emit(scope, { type: 'mcp-status', servers: slot.mcp, observed: true });
      },
    };
    const opened = await GrokSessionHandle.open({
      productSessionId: scope.sessionId, cwd,
      ...(!create && backendSessionId !== undefined ? { backendSessionId, replay } : {}),
    }, ports);
    slot.handle = opened.handle;
    slots.set(scope.sessionId, slot);
    opened.handle.subscribe((event) => emitAgent(slot, event));
    opened.handle.subscribeRunInterventions(async (event) => {
      const result = asRecord(await callHost(scope, 'intervention/event', event));
      return { accepted: result?.accepted === true };
    });
    const history = opened.replayEvents.map((event) => {
      const proposed = emissionFor(slot, event);
      return proposed.media ? { type: 'agent' as const, event: proposed.event, media: proposed.media } : { type: 'agent' as const, event: proposed.event };
    });
    const result = {
      backendSessionId: opened.backendSessionId,
      ...(opened.agentVersion !== undefined ? { agentVersion: opened.agentVersion } : {}),
      capabilities: createGrokSessionCapabilities(),
      options: opened.handle.getBackendOptions(),
    };
    // An older Host only reads the inline array; never stream to one that did not opt in.
    if (!replay || !replayStreaming) return { ...result, replayEvents: history };
    assertReplayFramesFit(scope, history);
    // Stdout order is historical order, and the count response closes the replay.
    for (const emission of history) emit(scope, emission);
    return { ...result, replayEvents: [], streamedReplayEventCount: history.length };
  }

  async function prompt(frame: Extract<AgentPluginFrame, { kind: 'request' }>) {
    const slot = requireSlot(frame);
    const params = asRecord(frame.params);
    const input = asRecord(params?.input);
    if (typeof params?.runId !== 'string' || typeof input?.text !== 'string') throw new PluginRequestError('invalid-request', 'invalid prompt');
    if (Array.isArray(input.images) && input.images.length > 0) throw new PluginRequestError('unavailable', 'Grok does not accept images yet');
    slot.runId = params.runId;
    return slot.handle.prompt(input as PromptInput);
  }

  async function select(frame: Extract<AgentPluginFrame, { kind: 'request' }>, kind: 'model' | 'effort' | 'mode') {
    const slot = requireSlot(frame);
    const id = asRecord(frame.params)?.[`${kind}Id`];
    if (typeof id !== 'string') throw new PluginRequestError('invalid-request', `missing ${kind}`);
    if (kind === 'model') await slot.handle.setModel(id);
    else if (kind === 'effort') await slot.handle.setEffort(id);
    else await slot.handle.setMode(id);
    return slot.handle.getBackendOptions();
  }

  async function workflowReport(frame: Extract<AgentPluginFrame, { kind: 'request' }>) {
    const slot = requireSlot(frame);
    const workflowId = asRecord(frame.params)?.workflowId;
    if (typeof workflowId !== 'string') throw new PluginRequestError('invalid-request', 'invalid workflow id');
    const text = await readGrokWorkflowReport(outputContext(slot), workflowId);
    if (text === undefined) throw new PluginRequestError('unavailable', 'workflow report not found');
    return { workflowId, text };
  }

  async function catalogMutate(params: unknown, run: (client: AcpClient, id: string, title: string) => Promise<unknown>): Promise<null> {
    const record = asRecord(params);
    if (typeof record?.backendSessionId !== 'string' || (record.title !== undefined && typeof record.title !== 'string')) {
      throw new PluginRequestError('invalid-request', 'invalid catalog change');
    }
    await withClient(undefined, (client) => run(client, record.backendSessionId as string, typeof record.title === 'string' ? record.title : ''));
    return null;
  }

  async function withClient<T>(cwd: string | undefined, run: (client: AcpClient) => Promise<T>): Promise<T> {
    const path = await requireBinary();
    const connection = new JsonRpcConnection(createGrokProcessTransport({ binaryPath: path, ...(cwd ? { cwd } : {}), env }), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: 15_000,
    });
    try {
      const client = new AcpClient(connection);
      await client.initialize({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'piwin', version: '0' } });
      return await run(client);
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  async function requireBinary(): Promise<string> {
    if (binaryPath !== undefined) return binaryPath;
    const status = await detectGrokCli({ env });
    if (status.state === 'not-installed') throw new PluginRequestError('unavailable', 'Grok CLI is not installed');
    binaryPath = status.binaryPath;
    return status.binaryPath;
  }

  function requireSlot(frame: Extract<AgentPluginFrame, { kind: 'request' }>): SessionSlot {
    if (frame.scope.kind !== 'session') throw new PluginRequestError('invalid-request', 'session scope required');
    const slot = slots.get(frame.scope.sessionId);
    if (!slot || slot.scope.runtimeGenerationId !== frame.scope.runtimeGenerationId) {
      throw new PluginRequestError('unavailable', 'session is not open in this generation');
    }
    return slot;
  }

  function emitAgent(slot: SessionSlot, event: AgentEvent): void {
    const proposed = emissionFor(slot, event);
    emit(slot.scope, proposed.media ? { type: 'agent', event: proposed.event, media: proposed.media } : { type: 'agent', event: proposed.event });
  }

  function emissionFor(slot: SessionSlot, event: AgentEvent) {
    return attachGrokMediaProposal(event, outputContext(slot));
  }

  function outputContext(slot: SessionSlot) {
    return { sessionId: slot.scope.sessionId, backendSessionId: slot.handle.backendSessionId, cwd: slot.cwd };
  }

  async function release(sessionId: string): Promise<void> {
    const slot = slots.get(sessionId);
    slots.delete(sessionId);
    await slot?.handle.release();
  }

  async function releaseAll(): Promise<void> {
    await Promise.all([...slots.keys()].map((sessionId) => release(sessionId)));
  }
}

class PluginRequestError extends Error {
  override readonly name = 'PluginRequestError';
  constructor(readonly code: 'invalid-request' | 'unavailable' | 'backend-error', message: string) {
    super(message);
  }
}

function parseDecision(value: unknown): AgentPluginPermissionDecision {
  const record = asRecord(value);
  if (record?.cancelled === true) return { cancelled: true };
  if (typeof record?.optionId === 'string') return { optionId: record.optionId };
  return { cancelled: true };
}

function parseIntervention(value: unknown): BackendRunIntervention {
  const record = asRecord(value);
  if (!record || typeof record.interventionId !== 'string' || typeof record.revision !== 'number' ||
      typeof record.sessionId !== 'string' || typeof record.runId !== 'string' || typeof record.runtimeGenerationId !== 'string' ||
      typeof record.sequence !== 'number' || typeof record.text !== 'string') {
    throw new PluginRequestError('invalid-request', 'invalid interjection');
  }
  return {
    interventionId: record.interventionId, revision: record.revision, sessionId: record.sessionId,
    runId: record.runId, runtimeGenerationId: record.runtimeGenerationId, sequence: record.sequence, text: record.text,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
