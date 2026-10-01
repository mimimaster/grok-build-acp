# grok-build-acp

Grok Build session backend for piwin. The installable tree is this repository; it does not include the Grok CLI.

The installable tree is `piwin.json` plus the self-contained `dist/agent.mjs` produced by `pnpm build`. Installing that tree does not need the piwin monorepo or this repo's `node_modules`. The Grok CLI is not included.
