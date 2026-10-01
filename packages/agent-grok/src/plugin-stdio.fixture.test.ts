import { execFile, spawn } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const outside = await mkdtemp(join(tmpdir(), 'piwin-agent-grok-'));
const artifact = join(outside, 'agent.mjs');
const fakeGrok = join(outside, 'fake-grok.mjs');

afterAll(async () => {
  await rm(outside, { recursive: true, force: true });
});

describe('standalone Grok plugin artifact', () => {
  it('runs outside the repository and checks a Grok stdio process', async () => {
    await writeFile(fakeGrok, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method !== 'initialize') return;
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
    protocolVersion: 1, authMethods: [], _meta: { agentVersion: '1.0.44', defaultAuthMethodId: 'cached_token' },
  } }) + '\\n');
});
`);
    await chmod(fakeGrok, 0o755);
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    await promisify(execFile)(process.execPath, ['scripts/build-plugin.mjs'], { cwd: packageRoot });
    await copyFile(join(packageRoot, 'dist', 'agent.mjs'), artifact);
    const bundled = await readFile(artifact, 'utf8');
    expect(bundled).not.toContain('from "@piwin/');
    expect(bundled).not.toContain('node_modules');
    const child = spawn(process.execPath, [artifact], {
      cwd: outside,
      env: { ...process.env, PIWIN_GROK_BIN: fakeGrok, HOME: outside },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<string, (value: unknown) => void>();
    lines.on('line', (line) => {
      const frame = JSON.parse(line) as { requestId?: string };
      if (frame.requestId) pending.get(frame.requestId)?.(frame);
    });
    const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
      const requestId = method.replaceAll('/', '-');
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
      pending.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
      child.stdin.write(`${JSON.stringify({
        protocolVersion: 1, kind: 'request', scope: { kind: 'plugin' }, requestId, method, params,
      })}\n`);
    });
    const initialized = await request('plugin/initialize', {
      agentId: 'grok', pluginRevision: 'a'.repeat(64), hostProtocolVersion: 1, runtime: {},
    }) as { result?: { protocolVersion?: number } };
    const checked = await request('check', { refresh: true }) as { result?: { state?: string; version?: string } };
    child.stdin.end();
    expect(initialized.result?.protocolVersion).toBe(1);
    expect(checked.result).toMatchObject({ state: 'ready', version: '1.0.44' });
    expect(artifact.startsWith(tmpdir())).toBe(true);
  }, 60_000);
});
