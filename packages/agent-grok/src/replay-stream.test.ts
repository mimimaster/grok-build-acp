import { describe, expect, it } from 'vitest';
import { parseAgentPluginFrame, type AgentPluginAgentEmission } from '@piwin/contracts';
import { assertReplayFramesFit, replayEventFrame } from './replay-stream.js';

const scope = { kind: 'session' as const, sessionId: 'product-1', runtimeGenerationId: 'generation-1' };
const text = (delta: string): AgentPluginAgentEmission =>
  ({ type: 'agent', event: { type: 'message/text_delta', messageId: 'historical', delta } });

describe('streamed historical replay', () => {
  it('frames each event so the Host parser accepts it for the loading generation', () => {
    const line = JSON.stringify(replayEventFrame(scope, text('界'.repeat(450))));
    expect(parseAgentPluginFrame(line, { scope, kind: 'event' })).toMatchObject({ kind: 'event', scope });
  });

  it('accepts a history far above one frame when every event fits', () => {
    const emissions = Array.from({ length: 1826 }, (_, index) => text(`${index}:${'界'.repeat(450)}`));
    const encoder = new TextEncoder();
    const total = emissions.reduce(
      (sum, emission) => sum + encoder.encode(JSON.stringify(replayEventFrame(scope, emission))).byteLength, 0);
    expect(total).toBeGreaterThan(2 * 1024 * 1024);
    expect(() => assertReplayFramesFit(scope, emissions)).not.toThrow();
  });

  it('fails the load when one event cannot fit a frame, naming which', () => {
    const emissions = [text('ok'), text('x'.repeat(4096)), text('ok')];
    expect(() => assertReplayFramesFit(scope, emissions, 1024)).toThrow(/historical event 2 of 3 .* above the 1024-byte frame limit/);
  });

  it('measures UTF-8 bytes, not characters', () => {
    // 300 CJK characters are 900 bytes: under a 1000-character count, over a 600-byte limit.
    expect(() => assertReplayFramesFit(scope, [text('界'.repeat(300))], 600)).toThrow(/frame limit/);
  });
});
