import type {
  ApplyFailure,
  ApplyStep,
  ChangeRecord,
  Clock,
  IdFactory,
  Proposal,
  ProposalStore,
  SurfaceStore,
} from '@evogen/kernel';

export interface ApplyReport {
  readonly records: readonly ChangeRecord[];
  readonly failures: readonly ApplyFailure[];
  readonly proposal: Proposal;
}

/**
 * Two-phase write: only approved proposals may be applied. Each expression is
 * planned (pure) and applied (drift-checked) independently, so a failure in
 * one does not roll back the others and every applied step leaves a
 * ChangeRecord for exact revert.
 */
export async function applyProposal(
  surfaces: SurfaceStore,
  store: ProposalStore,
  ids: IdFactory,
  clock: Clock,
  proposal: Proposal,
): Promise<ApplyReport> {
  if (proposal.status !== 'approved') {
    throw new Error(`proposal ${proposal.id} is not approved (status: ${proposal.status})`);
  }

  const specs = await surfaces.list();
  const records: ChangeRecord[] = [];
  const failures: ApplyFailure[] = [];

  for (const expression of proposal.expressions) {
    const spec = specs.find((item) => item.id === expression.surfaceId);
    if (!spec) {
      failures.push({ expressionId: expression.id, reason: `unknown surface: ${expression.surfaceId}` });
      continue;
    }
    try {
      const changeId = ids.next('chg');
      const step: ApplyStep = await surfaces.plan({
        surface: spec,
        op: expression.op,
        payload: expression.payload,
        changeId,
        expressionId: expression.id,
        at: clock.now(),
      });
      const record = await surfaces.apply(step);
      records.push(record);
      await store.appendChange(record);
    } catch (error) {
      failures.push({
        expressionId: expression.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status = records.length === 0 ? 'approved' : failures.length > 0 ? 'partially_applied' : 'applied';
  const updated: Proposal = { ...proposal, status };
  await store.saveProposal(updated);
  return { records, failures, proposal: updated };
}

/** Exact revert of one marked block; the change stays on record as reverted. */
export async function revertChange(
  surfaces: SurfaceStore,
  store: ProposalStore,
  changeId: string,
): Promise<void> {
  const change = (await store.listChanges()).find((item) => item.changeId === changeId);
  if (!change) throw new Error(`unknown change: ${changeId}`);
  if (await store.isChangeReverted(changeId)) {
    throw new Error(`change ${changeId} is already reverted`);
  }
  await surfaces.revert(change);
  await store.markChangeReverted(changeId);
}
