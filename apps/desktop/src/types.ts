/** Mirrors the kernel domain types that the serve API returns. */

export type EvidenceKind = 'correction' | 'repetition' | 'failure' | 'preference' | 'win';
export type SurfaceKind = 'instructions' | 'memory' | 'skill';
export type SurfaceOp = 'append' | 'replace' | 'create';
export type ProposalStatus = 'draft' | 'approved' | 'rejected' | 'applied' | 'partially_applied';

export interface SurfaceRow {
  readonly id: string;
  readonly kind: SurfaceKind;
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
  readonly digest: string;
}

export interface StatusPayload {
  readonly host: string;
  readonly projectRoot: string;
  readonly sessionsRoot: string;
  readonly surfaces: readonly SurfaceRow[];
  readonly sessions: { readonly files: number; readonly newestModified: string };
}

export interface Signal {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly statement: string;
  readonly evidenceIds: readonly string[];
  readonly weight: number;
}

export interface Expression {
  readonly id: string;
  readonly surfaceId: string;
  readonly op: SurfaceOp;
  readonly payload: { readonly content: string; readonly before?: string };
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
}

export interface Critique {
  readonly risk: number;
  readonly confidence: number;
  readonly notes: string;
}

export interface Proposal {
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly status: ProposalStatus;
  readonly signals: readonly Signal[];
  readonly expressions: readonly Expression[];
  readonly critique?: Critique;
}

export interface Preview {
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly diff: string;
}

export interface StageEvent {
  readonly name: string;
  readonly itemCount: number;
  readonly durationMs: number;
}

export interface RunPayload {
  readonly serveRunId?: string;
  readonly status: 'idle' | 'running' | 'done' | 'error';
  readonly startedAt?: string;
  readonly stages?: readonly StageEvent[];
  readonly run?: { readonly id: string };
  readonly proposal?: Proposal;
  readonly previews?: readonly Preview[];
  readonly usage?: { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number };
  readonly surfacesUnchanged?: boolean;
  readonly error?: string;
}

export interface ChangeRecord {
  readonly changeId: string;
  readonly proposalId?: string;
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly op: SurfaceOp;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly appliedAt: string;
}

export interface ChangesPayload {
  readonly changes: readonly ChangeRecord[];
  readonly reverted: readonly string[];
}

export interface ApplyReport {
  readonly records: readonly ChangeRecord[];
  readonly failures: ReadonlyArray<{ readonly expressionId: string; readonly reason: string }>;
  readonly proposal: Proposal;
  readonly previews?: readonly Preview[];
}

export interface ModelConfigView {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKeySet: boolean;
  readonly source: 'env' | 'env-file' | 'user-config' | null;
}

export interface ConfigTestResult {
  readonly ok: boolean;
  readonly model?: string;
  readonly error?: string;
}
