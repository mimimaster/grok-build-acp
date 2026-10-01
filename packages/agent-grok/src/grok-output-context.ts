import { homedir } from 'node:os';
import { join } from 'node:path';

export type GrokOutputContext = { sessionId: string; backendSessionId: string; cwd: string };

function assertSafePathSegment(id: string, label: string): void {
  if (id.length === 0 || id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
}

/** Native output roots come from the durable binding, never tool-supplied directories. */
export function grokSessionOutputRoot(context: GrokOutputContext, home = homedir()): string {
  assertSafePathSegment(context.backendSessionId, 'Grok session id');
  return join(home, '.grok', 'sessions', encodeURIComponent(context.cwd), context.backendSessionId);
}
