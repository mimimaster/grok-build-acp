import { describe, expect, it } from 'vitest';
import { normalizeGrokMediaPresentation } from './grok-generated-media.js';
import { applyGrokToolUpdate, createGrokToolState, presentGrokTool } from './grok-tool-projection.js';

describe('Grok generated media receipts', () => {
  it('normalizes the observed imagine JSON receipt without interpreting its message', () => {
    expect(normalizeGrokMediaPresentation('image_gen', {
      kind: 'other', title: 'imagine: portrait',
      output: { text: JSON.stringify({ path: '/grok/session/images/1.jpg', message: 'Do not display it.' }) },
    })).toMatchObject({ kind: 'image', routedToolName: 'image_gen', targetPaths: ['/grok/session/images/1.jpg'] });
  });

  it('does not infer paths from prose, titles or other tools', () => {
    expect(normalizeGrokMediaPresentation('image_gen', {
      kind: 'other', title: 'images/1.jpg', output: { text: 'Saved to images/1.jpg' },
    }).targetPaths).toBeUndefined();
    expect(normalizeGrokMediaPresentation('read', {
      kind: 'filesystem', title: 'read', output: { text: '{"path":"/private/key.png"}' },
    }).targetPaths).toBeUndefined();
  });

  it('projects the native rawOutput path into the completed presentation', () => {
    const state = createGrokToolState({
      toolCallId: 'image-call',
      title: 'image_gen',
      _meta: { 'x.ai/tool': { name: 'image_gen' } },
    }, '2026-10-01T00:00:00.000Z');
    applyGrokToolUpdate(state, {
      status: 'completed',
      rawOutput: { path: '/grok/session/images/1.jpg', filename: '1.jpg' },
    }, '2026-10-01T00:00:01.000Z');
    const presentation = presentGrokTool(state);
    expect(presentation).toMatchObject({ kind: 'image', targetPaths: ['/grok/session/images/1.jpg'] });
  });
});
