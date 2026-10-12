import {
  AGENT_PLUGIN_MAX_FRAME_BYTES,
  type AgentPluginAgentEmission,
  type AgentPluginScope,
} from '@piwin/contracts';

type SessionScope = Extract<AgentPluginScope, { kind: 'session' }>;

/** The exact event envelope the Host parses, one historical emission per frame. */
export function replayEventFrame(scope: SessionScope, emission: AgentPluginAgentEmission) {
  return { protocolVersion: 1 as const, kind: 'event' as const, scope, emission };
}

/**
 * History leaves the adapter one frame per event because a long session does
 * not fit one `session/load` response. Every frame is checked before the first
 * is written: a single event above the frame limit fails the load explicitly,
 * since dropping or truncating it would silently lose history.
 */
export function assertReplayFramesFit(
  scope: SessionScope,
  emissions: readonly AgentPluginAgentEmission[],
  maxFrameBytes: number = AGENT_PLUGIN_MAX_FRAME_BYTES,
): void {
  const encoder = new TextEncoder();
  emissions.forEach((emission, index) => {
    const bytes = encoder.encode(JSON.stringify(replayEventFrame(scope, emission))).byteLength;
    if (bytes > maxFrameBytes) {
      throw new Error(
        `historical event ${index + 1} of ${emissions.length} is ${bytes} bytes, above the ${maxFrameBytes}-byte frame limit`,
      );
    }
  });
}
