/** Injected so the kernel stays deterministic under test. */
export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(prefix: string): string;
}
