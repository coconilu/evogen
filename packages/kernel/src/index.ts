export type { SurfaceKind, SurfaceOp, SurfaceSpec } from './domain/surface.js';
export type { RawSession, SessionMeta, SessionRef, SessionTurn, TurnRole } from './domain/session.js';
export type { Evidence, EvidenceKind, Signal } from './domain/evidence.js';
export type {
  Critique,
  Expression,
  ExpressionPayload,
  Proposal,
  ProposalStatus,
} from './domain/proposal.js';
export type { ApplyFailure, ApplyOutcome, ApplyStep, ChangeRecord } from './domain/change.js';

export type { SessionSource } from './ports/session-source.js';
export type { PlanInput, SurfaceStore } from './ports/surface-store.js';
export type { ModelClient, ModelRequest, ModelResponse, ModelUsage } from './ports/model-client.js';
export type { ProposalStore } from './ports/proposal-store.js';
export type { Clock, IdFactory } from './ports/clock.js';

export type { PipelineContext } from './pipeline/context.js';
export {
  KernelNotReadyError,
  type EvolutionPipeline,
  type PipelineRun,
  type Stage,
  type StageRecord,
} from './pipeline/pipeline.js';
export { runEvolution } from './pipeline/run.js';
