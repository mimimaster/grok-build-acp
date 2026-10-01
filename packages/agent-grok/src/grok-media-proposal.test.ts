import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { attachGrokMediaProposal } from './grok-media-proposal.js';

describe('Grok media proposals', () => {
  it('replaces a native absolute path with a relative proposal and drops paths outside the output root', () => {
    const context = { sessionId: 'session-1', backendSessionId: 'native-1', cwd: '/work/demo' };
    const root = join(homedir(), '.grok', 'sessions', encodeURIComponent(context.cwd), context.backendSessionId, 'images');
    const event: AgentEvent = {
      type: 'tool/end', toolCallId: 'image', isError: false,
      presentation: {
        kind: 'other', title: 'image_gen: a cat', routedToolName: 'image_gen',
        output: { text: JSON.stringify({ path: join(root, 'cat.png') }) },
      },
    };
    const proposed = attachGrokMediaProposal(event, context);
    expect(proposed.media?.[0]).toMatchObject({ directoryId: 'images', relativePath: 'cat.png', kind: 'image' });
    expect(JSON.stringify(proposed)).not.toContain(root);
    const escaped = attachGrokMediaProposal({
      ...event,
      presentation: { ...event.presentation!, output: { text: JSON.stringify({ path: '/tmp/secret.png' }) } },
    }, context);
    expect(escaped.media).toBeUndefined();
    expect(JSON.stringify(escaped.event)).not.toContain('/tmp/secret.png');
  });
});
