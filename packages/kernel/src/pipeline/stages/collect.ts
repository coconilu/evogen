import type { RawSession } from '../../domain/session.js';
import type { PipelineContext } from '../context.js';
import type { Stage } from '../pipeline.js';

export interface CollectOptions {
  /** How many of the newest sessions to pull in. Default 20. */
  readonly sessionLimit?: number;
}

/** Reads the newest sessions through the injected SessionSource. */
export function createCollectStage(options: CollectOptions = {}): Stage<void, readonly RawSession[]> {
  const limit = Math.max(1, options.sessionLimit ?? 20);
  return {
    name: 'collect',
    async run(_input: undefined, ctx: PipelineContext): Promise<readonly RawSession[]> {
      const refs = await ctx.sessions.list();
      const picked = refs.slice(0, limit);
      const sessions: RawSession[] = [];
      for (const ref of picked) {
        sessions.push(await ctx.sessions.read(ref));
      }
      return sessions;
    },
  };
}
