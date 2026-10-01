import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(packageRoot, 'dist', 'agent.mjs');
await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [join(packageRoot, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  packages: 'bundle',
  logLevel: 'warning',
});

// A v2 manifest must describe the exact bundle we just built: the Host verifies
// this digest before it ever launches the adapter, bundled or downloaded.
const version = '1.0.0';
const bytes = await readFile(outfile);
const sha256 = createHash('sha256').update(bytes).digest('hex');
let sourceRevision = '0'.repeat(40);
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).trim();
  if (/^[a-f0-9]{40}$/.test(head)) sourceRevision = head;
} catch {
  // Not a git checkout (packaged source): the zero revision is valid and pinned.
}
const manifest = {
  schemaVersion: 2,
  id: 'grok',
  name: 'Grok Build',
  version,
  minHostVersion: '0.0.0',
  protocol: 'piwin-agent-stdio',
  protocolVersion: 1,
  minHostProtocolVersion: 1,
  platforms: ['darwin', 'win32', 'linux'],
  verifiedCliVersions: ['1.0.41', '1.0.44', '1.0.46'],
  helpUrl: 'https://grok.com',
  sourceRevision,
  artifact: {
    format: 'node-esm',
    entrypoint: 'agent.mjs',
    url: `https://extension.piwinwin.com/agents/grok-${version}/agent.mjs`,
    sha256,
    byteSize: bytes.byteLength,
  },
  compatibleRevisions: [],
  unversionedBindingCompatible: false,
  // The adapter owns its own output layout; the Host only resolves what is declared here.
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
await writeFile(join(packageRoot, 'dist', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[agent-grok] dist/agent.mjs ${bytes.byteLength} bytes sha256=${sha256.slice(0, 12)}…`);
