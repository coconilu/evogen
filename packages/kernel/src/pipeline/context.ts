import type { Clock, IdFactory } from '../ports/clock.js';
import type { ModelClient } from '../ports/model-client.js';
import type { ProposalStore } from '../ports/proposal-store.js';
import type { SessionSource } from '../ports/session-source.js';
import type { SurfaceStore } from '../ports/surface-store.js';

/** Everything a stage is allowed to reach. Nothing here knows about a host. */
export interface PipelineContext {
  readonly sessions: SessionSource;
  readonly surfaces: SurfaceStore;
  readonly store: ProposalStore;
  readonly model: ModelClient;
  readonly clock: Clock;
  readonly ids: IdFactory;
}
