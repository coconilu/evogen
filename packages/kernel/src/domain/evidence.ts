/** What in a past session is worth remembering. */
export type EvidenceKind =
  | 'correction' // the user had to fix the agent
  | 'repetition' // the same instruction keeps coming back
  | 'failure' // a task failed, or took a wrong turn
  | 'preference' // an explicitly stated preference or convention
  | 'win'; // something that worked and should be kept

export interface Evidence {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: EvidenceKind;
  /** Verbatim quote from the session — every proposal must be traceable to one. */
  readonly quote: string;
  readonly note: string;
  /** 0..1 */
  readonly confidence: number;
}

/** Evidence clustered into something stable enough to act on. */
export interface Signal {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly statement: string;
  readonly evidenceIds: readonly string[];
  /** Higher means more sessions / stronger evidence support it. */
  readonly weight: number;
}
