import { invoke } from '@tauri-apps/api/core';
import type { Preview, Proposal, RunPayload, StatusPayload } from './types';

/**
 * In the Tauri shell the origin and token come from the Rust side (parsed
 * from the sidecar handshake). In plain-browser debug mode they can be
 * provided via VITE_API_ORIGIN / VITE_API_TOKEN.
 */
const inTauri = '__TAURI_INTERNALS__' in window;

async function apiOrigin(): Promise<string> {
  if (!inTauri) {
    const fallback = import.meta.env.VITE_API_ORIGIN;
    if (!fallback) throw new Error('浏览器调试需要设置 VITE_API_ORIGIN（指向 evogen serve 的地址）');
    return fallback;
  }
  return invoke<string>('api_origin');
}

async function apiToken(): Promise<string> {
  if (!inTauri) return import.meta.env.VITE_API_TOKEN ?? '';
  return invoke<string>('api_token');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const [origin, token] = await Promise.all([apiOrigin(), apiToken()]);
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function eventsUrl(): Promise<string> {
  const [origin, token] = await Promise.all([apiOrigin(), apiToken()]);
  return `${origin}/api/events?token=${encodeURIComponent(token)}`;
}

export const api = {
  status: (): Promise<StatusPayload> => request('/api/status'),
  startRun: (sessionLimit: number): Promise<{ serveRunId: string; status: string }> =>
    request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionLimit }),
    }),
  currentRun: (): Promise<RunPayload> => request('/api/runs/current'),
  proposals: (): Promise<{ proposals: readonly Proposal[] }> => request('/api/proposals'),
  proposal: (id: string): Promise<{ proposal: Proposal; previews: readonly Preview[] }> =>
    request(`/api/proposals/${encodeURIComponent(id)}`),
};
