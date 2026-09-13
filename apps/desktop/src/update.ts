import { check, type Update } from '@tauri-apps/plugin-updater';

/**
 * Update plumbing is wired end to end, but the update source stays inactive
 * until the minisign keypair is generated at first release (see docs/roadmap).
 * Every failure path stays quiet: the About panel shows the result instead.
 */
export type UpdateState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'up-to-date' }
  | { readonly phase: 'unavailable'; readonly reason: string }
  | { readonly phase: 'available'; readonly version: string; readonly notes: string }
  | { readonly phase: 'downloading'; readonly progress: number }
  | { readonly phase: 'installing' }
  | { readonly phase: 'failed'; readonly reason: string };

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update: Update | null = await check({ timeout: 10_000 });
    if (!update) return { phase: 'up-to-date' };
    return { phase: 'available', version: update.version, notes: update.body ?? '' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { phase: 'unavailable', reason };
  }
}

export async function installUpdate(update: Update, onProgress: (progress: number) => void): Promise<void> {
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0;
    else if (event.event === 'Progress') {
      total = event.data.contentLength ?? total;
      onProgress(total > 0 ? event.data.chunkLength / total : 0);
    } else if (event.event === 'Finished') onProgress(1);
  });
}
