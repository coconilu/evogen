import type { Evidence, Signal } from '../../domain/evidence.js';
import type { Stage } from '../pipeline.js';
import type { PipelineContext } from '../context.js';
import { similarity } from './internal/text.js';

export interface AggregateOptions {
  /** Greedy clustering threshold on text similarity, 0..1. Default 0.35. */
  readonly similarityThreshold?: number;
}

interface Cluster {
  readonly kind: Evidence['kind'];
  readonly members: Evidence[];
}

/**
 * Deterministic merge: no model involved. Evidence of the same kind whose
 * text is similar enough collapses into one signal; the weight is the number
 * of distinct supporting sessions.
 */
export function createAggregateStage(options: AggregateOptions = {}): Stage<readonly Evidence[], readonly Signal[]> {
  const threshold = Math.min(1, Math.max(0, options.similarityThreshold ?? 0.35));
  return {
    name: 'aggregate',
    async run(evidence: readonly Evidence[], ctx: PipelineContext): Promise<readonly Signal[]> {
      const clusters: Cluster[] = [];
      for (const item of evidence) {
        const target = clusters.find(
          (cluster) =>
            cluster.kind === item.kind &&
            cluster.members.some((member) => similarity(member.quote + ' ' + member.note, item.quote + ' ' + item.note) >= threshold),
        );
        if (target) target.members.push(item);
        else clusters.push({ kind: item.kind, members: [item] });
      }

      const signals: Signal[] = clusters.map((cluster) => {
        const representative = cluster.members.reduce((best, item) => (item.note.length > best.note.length ? item : best));
        const sessionIds = new Set(cluster.members.map((member) => member.sessionId));
        return {
          id: ctx.ids.next('sig'),
          kind: cluster.kind,
          statement: representative.note,
          evidenceIds: cluster.members.map((member) => member.id),
          weight: sessionIds.size,
        };
      });

      signals.sort((a, b) => b.weight - a.weight || a.statement.localeCompare(b.statement));
      return signals;
    },
  };
}
