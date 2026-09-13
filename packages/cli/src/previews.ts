import type { Proposal, SurfaceStore } from '@evogen/kernel';
import { renderDiff } from './diff.js';

export interface ExpressionPreview {
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly diff: string;
}

/**
 * Computes what each expression would change, without writing anything:
 * `SurfaceStore.plan` is pure, so this is safe to run for previews.
 */
export async function buildPreviews(
  surfaces: SurfaceStore,
  proposal: Proposal | undefined,
): Promise<ExpressionPreview[]> {
  if (!proposal) return [];
  const specs = await surfaces.list();
  const previews: ExpressionPreview[] = [];
  for (const expression of proposal.expressions) {
    const spec = specs.find((item) => item.id === expression.surfaceId);
    if (!spec) continue;
    const step = await surfaces.plan({
      surface: spec,
      op: expression.op,
      payload: expression.payload,
      changeId: 'preview',
      expressionId: expression.id,
      at: new Date(),
    });
    previews.push({
      expressionId: expression.id,
      surfaceId: expression.surfaceId,
      path: spec.path,
      before: step.before,
      after: step.after,
      diff: renderDiff(step.before, step.after),
    });
  }
  return previews;
}
