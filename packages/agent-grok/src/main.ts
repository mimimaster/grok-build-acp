import { serveAgentPlugin } from './plugin-server.js';

await serveAgentPlugin({ input: process.stdin, output: process.stdout });
