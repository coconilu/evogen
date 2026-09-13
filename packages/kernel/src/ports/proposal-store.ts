import type { ChangeRecord } from '../domain/change.js';
import type { Proposal, ProposalStatus } from '../domain/proposal.js';

/** Persistence for proposals and applied changes. Returns JSON-safe arrays. */
export interface ProposalStore {
  saveProposal(proposal: Proposal): Promise<void>;
  listProposals(filter?: { readonly status?: ProposalStatus }): Promise<readonly Proposal[]>;
  getProposal(id: string): Promise<Proposal | undefined>;
  appendChange(change: ChangeRecord): Promise<void>;
  listChanges(): Promise<readonly ChangeRecord[]>;
}
