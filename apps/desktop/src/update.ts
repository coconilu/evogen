import { check, type Update } from '@tauri-apps/plugin-updater';
import { useSyncExternalStore } from 'react';

/**
 * 共享更新状态：顶部横幅与「关于」页消费同一份状态，检查循环全局只跑一份。
 * 设计按 SKILL 规范：启动检查一次 + 每 30 分钟轮询；后台检查失败不弹窗，
 * 结果留在「关于」；发现新版本出提示条，可关闭且按目标版本记忆。
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'unavailable'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'failed';

export interface UpdateState {
  readonly phase: UpdatePhase;
  readonly version: string;
  readonly currentVersion: string;
  readonly reason: string;
  readonly progress: number;
}

let state: UpdateState = {
  phase: 'idle',
  version: '',
  currentVersion: '',
  reason: '',
  progress: 0,
};

const listeners = new Set<() => void>();

function patch(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 绑定：横幅与「关于」页共享同一份状态。 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
}

const DISMISS_KEY = 'evogen-update-dismissed-version';

export function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === version;
  } catch {
    return false;
  }
}

export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    // localStorage unavailable — the banner will simply reappear
  }
  patch({});
}

async function fetchCurrentVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

let started = false;

/** 应用启动时调用一次：启动检查 + 30 分钟轮询。非 Tauri 环境为空操作。 */
export function startUpdateLoop(): void {
  if (started || !('__TAURI_INTERNALS__' in window)) return;
  started = true;
  void fetchCurrentVersion().then((version) => patch({ currentVersion: version }));
  void checkNow();
  setInterval(() => void checkNow(), 30 * 60 * 1000);
}

/** 立即检查（也供「关于」页的手动按钮使用）。 */
export async function checkNow(): Promise<void> {
  if (state.phase === 'downloading' || state.phase === 'installing' || state.phase === 'checking') return;
  patch({ phase: 'checking' });
  try {
    const update: Update | null = await check({ timeout: 15_000 });
    if (update) patch({ phase: 'available', update, version: update.version, reason: '' });
    else patch({ phase: 'up-to-date', update: undefined, reason: '' });
  } catch (error) {
    // 静默降级：不打扰，状态在「关于」可见
    patch({
      phase: 'unavailable',
      update: undefined,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 下载并安装；Windows 由 NSIS 接管重启，macOS 通常需要手动重启。 */
export async function startInstall(): Promise<void> {
  const update = state.update;
  if (!update) return;
  patch({ phase: 'downloading', progress: 0 });
  try {
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
        received = 0;
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        patch({ progress: total > 0 ? Math.min(1, received / total) : 0 });
      } else if (event.event === 'Finished') {
        patch({ progress: 1 });
      }
    });
    patch({ phase: 'installing' });
  } catch (error) {
    patch({ phase: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
