/**
 * Write the installable extension manifest next to the bundled adapter.
 * The digest is of the bytes that ship; the Host re-hashes them before launch.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'packages', 'agent-grok', 'dist', 'agent.mjs');
const shipped = join(root, 'dist', 'agent.mjs');
const bytes = await readFile(built);
await mkdir(dirname(shipped), { recursive: true });
await copyFile(built, shipped);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const declaration = {
  schemaVersion: 1,
  id: 'grok',
  name: 'Grok Build',
  version: '1.0.0',
  minHostVersion: '0.0.0',
  protocol: 'piwin-agent-stdio',
  protocolVersion: 1,
  minHostProtocolVersion: 1,
  platforms: ['darwin', 'win32', 'linux'],
  verifiedCliVersions: ['1.0.41', '1.0.44', '1.0.46'],
  helpUrl: 'https://grok.com',
  artifact: {
    format: 'node-esm',
    entrypoint: 'dist/agent.mjs',
    sha256,
    byteSize: bytes.byteLength,
  },
  compatibleRevisions: [],
  unversionedBindingCompatible: false,
  outputDirectories: [
    {
      id: 'images',
      base: 'user-home',
      relativePath: '.grok/sessions/{encodedWorkingDirectory}/{backendSessionId}/images',
      kind: 'image',
    },
    {
      id: 'videos',
      base: 'user-home',
      relativePath: '.grok/sessions/{encodedWorkingDirectory}/{backendSessionId}/videos',
      kind: 'video',
    },
  ],
};
await writeFile(join(root, 'piwin.json'), `${JSON.stringify({ sessionBackend: declaration }, null, 2)}\n`);
console.log(`[grok-build] piwin.json sha256=${sha256.slice(0, 12)}… bytes=${bytes.byteLength}`);
