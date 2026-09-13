import type { ChangeRecord } from '../domain/change.js';
import type { Proposal, ProposalStatus } from '../domain/proposal.js';
import type { Clock, IdFactory } from '../ports/clock.js';
import type { ProposalStore } from '../ports/proposal-store.js';

/** Wall-clock clock. The kernel itself only ever reads it. */
export function systemClock(): Clock {
  return { now: () => new Date() };
}

/**
 * Readable, collision-safe ids without depending on crypto primitives:
 * `<prefix>_<counter base36>_<random base36>`.
 */
export function sequentialIds(): IdFactory {
  let counter = 0;
  return {
    next: (prefix: string) => {
      counter += 1;
      const random = Math.floor(Math.random() * 36 ** 6)
        .toString(36)
        .padStart(6, '0');
      return `${prefix}_${counter.toString(36)}_${random}`;
    },
  };
}

interface MemoryState {
  readonly proposals: Map<string, Proposal>;
  readonly changes: ChangeRecord[];
  readonly reverted: Set<string>;
}

/** In-memory store, the default for read-only runs and for tests. */
export function createMemoryStore(): ProposalStore {
  const state: MemoryState = { proposals: new Map(), changes: [], reverted: new Set() };
  return {
    async saveProposal(proposal: Proposal): Promise<void> {
      state.proposals.set(proposal.id, proposal);
    },
    async listProposals(filter?: { readonly status?: ProposalStatus }): Promise<readonly Proposal[]> {
      const all = [...state.proposals.values()];
      return filter?.status ? all.filter((p) => p.status === filter.status) : all;
    },
    async getProposal(id: string): Promise<Proposal | undefined> {
      return state.proposals.get(id);
    },
    async appendChange(change: ChangeRecord): Promise<void> {
      state.changes.push(change);
    },
    async listChanges(): Promise<readonly ChangeRecord[]> {
      return [...state.changes];
    },
    async isChangeReverted(changeId: string): Promise<boolean> {
      return state.reverted.has(changeId);
    },
    async markChangeReverted(changeId: string): Promise<void> {
      state.reverted.add(changeId);
    },
  };
}
