import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChangeRecord, Proposal, ProposalStatus, ProposalStore } from '@evogen/kernel';

interface StoreFile {
  readonly version: 1;
  proposals: Proposal[];
  changes: ChangeRecord[];
}

function emptyFile(): StoreFile {
  return { version: 1, proposals: [], changes: [] };
}

/**
 * JSON-file persistence for proposals and change records. Used when the user
 * opts into saving a run, and by `approve`/`apply`/`revert` later.
 */
export class FileProposalStore implements ProposalStore {
  private file: StoreFile | undefined;

  constructor(private readonly path: string) {}

  private async load(): Promise<StoreFile> {
    if (this.file) return this.file;
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      this.file = {
        version: 1,
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      };
    } catch {
      this.file = emptyFile();
    }
    return this.file;
  }

  private async persist(file: StoreFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const file = await this.load();
    const index = file.proposals.findIndex((item) => item.id === proposal.id);
    if (index >= 0) file.proposals[index] = proposal;
    else file.proposals.push(proposal);
    await this.persist(file);
  }

  async listProposals(filter?: { readonly status?: ProposalStatus }): Promise<readonly Proposal[]> {
    const file = await this.load();
    const all = [...file.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.status ? all.filter((p) => p.status === filter.status) : all;
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    const file = await this.load();
    return file.proposals.find((p) => p.id === id);
  }

  async appendChange(change: ChangeRecord): Promise<void> {
    const file = await this.load();
    file.changes.push(change);
    await this.persist(file);
  }

  async listChanges(): Promise<readonly ChangeRecord[]> {
    const file = await this.load();
    return [...file.changes].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  }
}
