/** A past conversation, normalized into something the pipeline can reason about. */
export type TurnRole = 'user' | 'assistant' | 'tool';

export interface SessionTurn {
  readonly role: TurnRole;
  readonly text?: string;
  readonly tool?: string;
  readonly args?: string;
  readonly result?: string;
}

export interface SessionRef {
  readonly id: string;
  readonly path: string;
  readonly mtimeMs: number;
}

export interface SessionMeta {
  /** Host that produced the session, e.g. `codex`. */
  readonly host: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly startedAt?: string;
}

export interface RawSession {
  readonly ref: SessionRef;
  readonly meta: SessionMeta;
  readonly turns: readonly SessionTurn[];
}
