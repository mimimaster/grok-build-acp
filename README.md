# grok-build-acp

Grok Build session backend for piwin. The installable tree is this repository; it does not include the Grok CLI.

The installable tree is `piwin.json` plus the self-contained `dist/agent.mjs` produced by `pnpm build`. Installing that tree does not need the piwin monorepo or this repo's `node_modules`. The Grok CLI is not included.

The optional `catalog/usage` query reads completed model requests from Grok's
local `logs/unified.jsonl`, restricted to Host-bound native sessions and their
verified native subagents. Child requests are attributed through recursive
`subagents/<id>/meta.json` parent relationships, never by sharing a process id.
Explicitly Host-bound children retain their own attribution. It returns
normalized tokens, model duration and first-token latency without waiting for
the enclosing turn to finish. First-token timing uses reported `ttft_ms` when
present, or matches the session's `first_token` event to the inference interval.
Missing measurements stay absent. Prompt-cache tokens are separated from
uncached input; reasoning tokens are already included in completion tokens.
The query is data-only: it does not launch the Grok CLI, access credentials or
return arbitrary log context. Each file read is bounded to its last 16 MiB;
rotated or missing native logs fall back to the Host's finalized turn records.
