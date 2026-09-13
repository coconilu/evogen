import type { EvolutionPipeline } from './pipeline.js';
import type { CollectOptions } from './stages/collect.js';
import type { AggregateOptions } from './stages/aggregate.js';
import { createAggregateStage } from './stages/aggregate.js';
import { createCollectStage } from './stages/collect.js';
import { createCritiqueStage } from './stages/critique.js';
import { createDistillStage } from './stages/distill.js';
import { createProposeStage } from './stages/propose.js';

export interface PipelineOptions {
  readonly collect?: CollectOptions;
  readonly aggregate?: AggregateOptions;
}

/**
 * The canonical five stages wired together. Everything host-specific arrives
 * through the PipelineContext at run time; nothing here knows about a host.
 */
export function createEvolutionPipeline(options: PipelineOptions = {}): EvolutionPipeline {
  return {
    collect: createCollectStage(options.collect),
    distill: createDistillStage(),
    aggregate: createAggregateStage(options.aggregate),
    propose: createProposeStage(),
    critique: createCritiqueStage(),
  };
}
