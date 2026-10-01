import type { AgentEvent } from '@piwin/contracts';

/** Keep attachment imports ahead of later message/turn events without blocking ACP reads. */
export class GrokEventDelivery {
  private pending = Promise.resolve();
  constructor(
    private readonly deliver: (event: AgentEvent) => void,
    private readonly prepare?: (event: AgentEvent) => Promise<AgentEvent>,
  ) {}
  emit(event: AgentEvent): void {
    if (!this.prepare) { this.deliver(event); return; }
    const prepare = this.prepare;
    this.pending = this.pending.then(async () => { this.deliver(await prepare(event)); });
  }
  flush(): Promise<void> { return this.pending; }
}
