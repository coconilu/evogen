import type { RawSession, SessionRef } from '../domain/session.js';

/**
 * Where past conversations come from. Implemented by adapters; the kernel never
 * learns anything about log formats, directories or hosts.
 */
export interface SessionSource {
  readonly host: string;
  /** Newest first. */
  list(): Promise<readonly SessionRef[]>;
  read(ref: SessionRef): Promise<RawSession>;
}
