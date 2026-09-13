import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type CodexAdapter, createCodexAdapter } from '@evogen/adapter-codex';
import { type ProposalStatus, sequentialIds, systemClock } from '@evogen/kernel';
import { applyProposal, revertChange } from '../apply.js';
import {
  MissingModelConfigError,
  openStore,
  type RunResult,
  resolveModelConfigOrThrow,
  runPipeline,
  type StageEvent,
} from '../pipeline-runner.js';
import { buildPreviews, type ExpressionPreview } from '../previews.js';

export interface ServeArgs {
  /** 0 (default) lets the OS pick a free port. */
  readonly port?: number;
  readonly projectRoot?: string;
  readonly sessionsRoot?: string;
}

interface RunState {
  readonly serveRunId: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  stages: StageEvent[];
  result?: RunResult;
  previews?: ExpressionPreview[];
  error?: string;
}

const MAX_BODY_BYTES = 1024 * 1024;

export async function runServe(args: ServeArgs): Promise<number> {
  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest();
  const store = openStore();

  let runState: RunState | undefined;
  const sseClients = new Set<ServerResponse>();

  const emit = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.write(payload);
  };

  const startRun = (sessionLimit: number): RunState => {
    const state: RunState = {
      serveRunId: `srv_${randomBytes(6).toString('base64url')}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [],
    };
    runState = state;
    runPipeline(adapter, {
      sessionLimit,
      store,
      onStage: (event) => {
        state.stages.push(event);
        emit('stage', { serveRunId: state.serveRunId, ...event });
      },
    })
      .then(async (result) => {
        state.result = result;
        state.previews = await buildPreviews(adapter.surfaces, result.proposal);
        state.status = 'done';
        if (result.proposal) await store.saveProposal(result.proposal);
        emit('run-done', serializeRun(state));
      })
      .catch((error: unknown) => {
        state.status = 'error';
        state.error = error instanceof Error ? error.message : String(error);
        emit('run-error', { serveRunId: state.serveRunId, error: state.error });
      });
    return state;
  };

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://127.0.0.1`);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (!authorized(request, url, tokenHash)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (route === 'GET /api/status') {
      sendJson(response, 200, await statusPayload(adapter));
      return;
    }
    if (route === 'GET /api/surfaces/content') {
      const id = url.searchParams.get('id') ?? '';
      const spec = (await adapter.surfaces.list()).find((item) => item.id === id);
      if (!spec) {
        sendJson(response, 404, { error: `unknown surface: ${id}` });
        return;
      }
      sendJson(response, 200, {
        id: spec.id,
        kind: spec.kind,
        path: spec.path,
        content: await adapter.surfaces.read(spec),
      });
      return;
    }
    if (route === 'POST /api/runs') {
      if (runState?.status === 'running') {
        sendJson(response, 409, { error: 'a run is already in progress' });
        return;
      }
      const body = await readJson(request);
      const limit = Math.min(Math.max(1, Number(body['sessionLimit'] ?? 20) || 20), 200);
      try {
        // fail fast when no model is configured
        await resolveModelConfigOrThrow();
      } catch (error) {
        if (error instanceof MissingModelConfigError) {
          sendJson(response, 503, { error: error.message });
          return;
        }
        throw error;
      }
      const state = startRun(limit);
      sendJson(response, 202, { serveRunId: state.serveRunId, status: state.status });
      return;
    }
    if (route === 'GET /api/runs/current') {
      sendJson(response, 200, runState ? serializeRun(runState) : { status: 'idle' });
      return;
    }
    if (route === 'GET /api/proposals') {
      sendJson(response, 200, { proposals: await store.listProposals() });
      return;
    }
    const proposalMatch = /^GET \/api\/proposals\/([^/]+)$/.exec(route);
    if (proposalMatch) {
      const id = decodeURIComponent(proposalMatch[1] ?? '');
      const proposal = await store.getProposal(id);
      if (!proposal) {
        sendJson(response, 404, { error: `unknown proposal: ${id}` });
        return;
      }
      sendJson(response, 200, { proposal, previews: await buildPreviews(adapter.surfaces, proposal) });
      return;
    }

    // --- write loop (M2): two-phase apply and exact revert -----------------
    const statusMatch = /^POST \/api\/proposals\/([^/]+)\/(approve|reject)$/.exec(route);
    if (statusMatch) {
      const id = decodeURIComponent(statusMatch[1] ?? '');
      const action = statusMatch[2];
      const proposal = await store.getProposal(id);
      if (!proposal) {
        sendJson(response, 404, { error: `unknown proposal: ${id}` });
        return;
      }
      if (proposal.status !== 'draft') {
        sendJson(response, 409, {
          error: `proposal status is "${proposal.status}", only "draft" can be ${action}d`,
        });
        return;
      }
      const next: ProposalStatus = action === 'approve' ? 'approved' : 'rejected';
      const updated = { ...proposal, status: next };
      await store.saveProposal(updated);
      sendJson(response, 200, { proposal: updated });
      return;
    }
    const applyMatch = /^POST \/api\/proposals\/([^/]+)\/apply$/.exec(route);
    if (applyMatch) {
      const id = decodeURIComponent(applyMatch[1] ?? '');
      const proposal = await store.getProposal(id);
      if (!proposal) {
        sendJson(response, 404, { error: `unknown proposal: ${id}` });
        return;
      }
      try {
        const report = await applyProposal(adapter.surfaces, store, sequentialIds(), systemClock(), proposal);
        sendJson(response, 200, {
          records: report.records,
          failures: report.failures,
          proposal: report.proposal,
          previews: await buildPreviews(adapter.surfaces, report.proposal),
        });
      } catch (error) {
        sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (route === 'GET /api/changes') {
      const changes = await store.listChanges();
      const reverted = [];
      for (const change of changes) {
        if (await store.isChangeReverted(change.changeId)) reverted.push(change.changeId);
      }
      sendJson(response, 200, { changes, reverted });
      return;
    }
    const revertMatch = /^POST \/api\/changes\/([^/]+)\/revert$/.exec(route);
    if (revertMatch) {
      const changeId = decodeURIComponent(revertMatch[1] ?? '');
      try {
        await revertChange(adapter.surfaces, store, changeId);
        sendJson(response, 200, { ok: true, changeId });
      } catch (error) {
        sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (route === 'GET /api/events') {
      response.writeHead(200, {
        ...corsHeaders(),
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`event: hello\ndata: {}\n\n`);
      sseClients.add(response);
      request.on('close', () => {
        sseClients.delete(response);
      });
      return;
    }

    sendJson(response, 404, { error: `no route: ${route}` });
  }

  await new Promise<void>((resolve) => {
    server.listen(args.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : args.port;

  // machine-readable handshake for the desktop shell; keep stdout single-line
  process.stdout.write(`EVOGEN_READY port=${port} token=${token} pid=${process.pid}\n`);
  process.stderr.write(`evogen serve listening on http://127.0.0.1:${port}\n`);

  const heartbeat = setInterval(() => {
    for (const client of sseClients) client.write(`: ping\n\n`);
  }, 15_000);
  heartbeat.unref();

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(heartbeat);
      for (const client of sseClients) client.end();
      server.close(() => resolve());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}

function serializeRun(state: RunState): Record<string, unknown> {
  return {
    serveRunId: state.serveRunId,
    status: state.status,
    startedAt: state.startedAt,
    stages: state.stages,
    ...(state.status === 'done'
      ? {
          run: state.result?.run,
          proposal: state.result?.proposal,
          previews: state.previews,
          usage: state.result?.usage,
          surfacesUnchanged: state.result?.surfacesUnchanged,
        }
      : {}),
    ...(state.status === 'error' ? { error: state.error } : {}),
  };
}

async function statusPayload(adapter: CodexAdapter): Promise<Record<string, unknown>> {
  const surfaces = [];
  for (const spec of await adapter.surfaces.list()) {
    const content = spec.exists ? await adapter.surfaces.read(spec) : '';
    surfaces.push({
      id: spec.id,
      kind: spec.kind,
      path: spec.path,
      exists: spec.exists,
      bytes: Buffer.byteLength(content, 'utf8'),
      digest: spec.exists ? await adapter.surfaces.digest(spec) : '',
    });
  }
  const refs = await adapter.sessions.list();
  return {
    host: adapter.host,
    projectRoot: adapter.projectRoot,
    sessionsRoot: adapter.sessionsRoot,
    surfaces,
    sessions: {
      files: refs.length,
      newestModified: refs[0]?.mtimeMs ? new Date(refs[0].mtimeMs).toISOString() : '',
    },
  };
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
  };
}

function authorized(request: IncomingMessage, url: URL, tokenHash: Buffer): boolean {
  const header = request.headers['authorization'] ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : (url.searchParams.get('token') ?? '');
  if (presented.length === 0) return false;
  const presentedHash = createHash('sha256').update(presented).digest();
  return timingSafeEqual(presentedHash, tokenHash);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...corsHeaders(), 'content-type': 'application/json' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}
