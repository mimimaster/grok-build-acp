/**
 * Prove the shipped adapter speaks the plugin protocol outside this repo's
 * node_modules. It must answer plugin/initialize without spawning the Grok CLI.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifact = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'agent.mjs');
const child = spawn(process.execPath, [artifact], { stdio: ['pipe', 'pipe', 'pipe'] });
const frame = {
  protocolVersion: 1,
  kind: 'request',
  scope: { kind: 'plugin' },
  requestId: 'handshake-1',
  method: 'plugin/initialize',
  params: { agentId: 'grok', pluginRevision: 'local', hostProtocolVersion: 1, runtime: {} },
};
child.stdin.write(`${JSON.stringify(frame)}\n`);
const timer = setTimeout(() => {
  console.error('handshake timed out');
  child.kill('SIGKILL');
  process.exit(1);
}, 10_000);
const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.requestId !== 'handshake-1') return;
  clearTimeout(timer);
  if (message.ok !== true || message.result?.agentId !== 'grok' || message.result?.protocolVersion !== 1) {
    console.error('unexpected handshake', line);
    child.kill('SIGKILL');
    process.exit(1);
  }
  console.log('[grok-build] protocol handshake ok');
  child.kill('SIGTERM');
  process.exit(0);
});
child.on('exit', (code) => {
  if (code && code !== 0 && code !== 143 && code !== 15) process.exit(code);
});
