import { open } from 'node:fs/promises';

/** Native telemetry files may be large or have an active writer; every read is bounded. */
export async function readGrokNativeFile(path: string, maxBytes: number, tail = false): Promise<string | undefined> {
  let handle;
  try { handle = await open(path, 'r'); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const details = await handle.stat();
    if (!details.isFile() || (!tail && details.size > maxBytes)) return undefined;
    const start = Math.max(0, details.size - maxBytes);
    const bytes = Buffer.alloc(Math.min(details.size, maxBytes));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    const text = bytes.subarray(0, bytesRead).toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { await handle.close(); }
}
