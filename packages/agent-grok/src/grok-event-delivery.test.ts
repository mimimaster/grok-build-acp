import { expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { GrokEventDelivery } from './grok-event-delivery.js';
it('waits for attachment import before subsequent messages and flush completion', async () => {
  const events: AgentEvent[] = [];
  let resolveImport: ((event: AgentEvent) => void) | undefined;
  const delivery = new GrokEventDelivery((event) => events.push(event), (event) => event.type === 'tool/end' ? new Promise((resolve) => { resolveImport = resolve; }) : Promise.resolve(event));
  const generated: AgentEvent = { type: 'tool/end', toolCallId: 'image', isError: false };
  delivery.emit(generated); delivery.emit({ type: 'message/start', messageId: 'later', role: 'assistant' });
  await Promise.resolve(); expect(events).toEqual([]);
  if (!resolveImport) throw new Error('import was not called');
  resolveImport({ ...generated, attachments: [{ id: 'asset', kind: 'media', path: '/vault/asset.png', mimeType: 'image/png', byteSize: 1, source: 'generated' }] });
  await delivery.flush();
  expect(events.map((event) => event.type)).toEqual(['tool/end', 'message/start']);
  expect(events[0]).toMatchObject({ attachments: [{ id: 'asset' }] });
});
