#!/usr/bin/env node
import { createCodexAdapter } from '@evogen/adapter-codex';
import { runApply, runApprove, runChanges, runReject, runRevert } from './commands/lifecycle.js';
import { runProposals } from './commands/proposals.js';
import { runServe } from './commands/serve.js';

function runLifecycle(
  command: 'approve' | 'reject' | 'apply' | 'revert',
  args: {
    readonly id: string;
    readonly storePath?: string;
    readonly projectRoot?: string;
    readonly sessionsRoot?: string;
  },
): Promise<number> {
  switch (command) {
    case 'approve':
      return runApprove(args);
    case 'reject':
      return runReject(args);
    case 'apply':
      return runApply(args);
    case 'revert':
      return runRevert(args);
  }
}

const USAGE = `evogen — session-driven self-evolution for AI coding agents

Usage:
  evogen status [--json] [--all] [--project <dir>] [--sessions <dir>]
  evogen proposals [--json] [--save] [--limit <n>] [--project <dir>] [--sessions <dir>]
  evogen approve|reject|apply <proposal-id>
  evogen changes
  evogen revert <change-id>
  evogen serve [--port <n>] [--project <dir>] [--sessions <dir>]
  evogen help
  evogen version

Commands:
  status      Read-only. Lists the surfaces this runtime can evolve and how many
              sessions are available. Writes nothing, opens no network.
  proposals   Runs the evolution pipeline (read-only): sessions -> evidence ->
              signals -> proposal -> critique, then prints diff previews.
              Needs a model endpoint via EVOGEN_MODEL_* (see .env.example).
              Writes nothing unless --save is given.
  serve       Local API server for the desktop console. Binds 127.0.0.1 only,
              answers REST + SSE, and prints a single handshake line
              (EVOGEN_READY port=… token=… pid=…) on stdout.

Options:
  --json             Machine-readable output.
  --all              List every skill surface instead of the first few.
  --project <dir>    Project root that owns the instruction file (default: cwd).
                     Only affects project-level surfaces (e.g. agents.project);
                     user-level surfaces always point at the host's own home.
  --sessions <dir>   Session log directory (default: the host's own store).
  --limit <n>        How many of the newest sessions to consider (default 20).
  --save             Persist the proposal to the local store (~/.evogen).
  --store <path>     Store file location (default ~/.evogen/store.json).
  --port <n>         TCP port for serve (default: a random free port).

Write loop (two-phase, changes land inside marked blocks only):
  evogen approve <proposal-id>   Mark a draft proposal as approved.
  evogen reject <proposal-id>    Mark a draft proposal as rejected.
  evogen apply <proposal-id>     Write the approved proposal's expressions.
                                 Prints every target path it writes to.
  evogen changes                 List recorded changes (with revert state).
  evogen revert <change-id>      Remove exactly that change's marked block.
`;

interface Args {
  readonly command: string;
  readonly id: string | undefined;
  readonly json: boolean;
  readonly all: boolean;
  readonly save: boolean;
  readonly limit: number;
  readonly port: number | undefined;
  readonly storePath: string | undefined;
  readonly projectRoot: string | undefined;
  readonly sessionsRoot: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let json = false;
  let all = false;
  let save = false;
  let limit = 20;
  let port: number | undefined;
  let storePath: string | undefined;
  let projectRoot: string | undefined;
  let sessionsRoot: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--save') {
      save = true;
    } else if (arg === '--limit') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) limit = value;
      i += 1;
    } else if (arg === '--port') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) port = value;
      i += 1;
    } else if (arg === '--store') {
      storePath = argv[i + 1];
      i += 1;
    } else if (arg === '--project') {
      projectRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--sessions') {
      sessionsRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      positional.push('help');
    } else if (arg !== undefined && !arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? 'status',
    id: positional[1],
    json,
    all,
    save,
    limit,
    port,
    storePath,
    projectRoot,
    sessionsRoot,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

const SKILL_PREVIEW_LIMIT = 5;

function isoOrDash(ms: number | undefined): string {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : '-';
}

async function status(args: Args): Promise<number> {
  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });

  const surfaces = await adapter.surfaces.list();
  const surfaceRows = [];
  for (const surface of surfaces) {
    const text = await adapter.surfaces.read(surface);
    surfaceRows.push({
      id: surface.id,
      kind: surface.kind,
      path: surface.path,
      exists: surface.exists,
      bytes: Buffer.byteLength(text, 'utf8'),
      digest: surface.exists ? await adapter.surfaces.digest(surface) : '',
    });
  }

  const refs = await adapter.sessions.list();
  const newest = refs[0];
  const newestTurns = newest ? (await adapter.sessions.read(newest)).turns.length : 0;

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          host: adapter.host,
          projectRoot: adapter.projectRoot,
          sessionsRoot: adapter.sessionsRoot,
          surfaces: surfaceRows,
          sessions: {
            files: refs.length,
            newestPath: newest?.path ?? '',
            newestModified: isoOrDash(newest?.mtimeMs),
            newestTurns,
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push('evogen status');
  lines.push('');
  lines.push(`${pad('host', 16)}${adapter.host}`);
  lines.push(`${pad('project root', 16)}${adapter.projectRoot}`);
  lines.push(`${pad('sessions root', 16)}${adapter.sessionsRoot}`);
  lines.push('');
  const instructions = surfaceRows.filter((row) => row.kind !== 'skill');
  const skills = surfaceRows.filter((row) => row.kind === 'skill');
  const shownSkills = args.all ? skills : skills.slice(0, SKILL_PREVIEW_LIMIT);

  lines.push('surfaces');
  for (const row of [...instructions, ...shownSkills]) {
    const mark = row.exists ? '✓' : '✗';
    const size = row.exists ? formatBytes(row.bytes) : 'missing';
    const digest = row.digest === '' ? '-' : row.digest;
    lines.push(
      ['  ' + mark, pad(row.id, 22), pad(row.kind, 13), pad(size, 9), pad(digest, 34), row.path].join(' '),
    );
  }
  if (skills.length > shownSkills.length) {
    lines.push(`    … ${skills.length - shownSkills.length} more skill surfaces (use --all to list them)`);
  }
  lines.push('');
  lines.push('sessions');
  lines.push(`  ${pad('files', 16)}${refs.length}`);
  lines.push(`  ${pad('newest', 16)}${isoOrDash(newest?.mtimeMs)}`);
  lines.push(`  ${pad('newest turns', 16)}${newestTurns}`);
  lines.push('');
  lines.push('read-only command: nothing was written, nothing was sent anywhere.');
  lines.push('next: `evogen proposals` runs the read-only analysis; see docs/roadmap.md.');

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'status':
      return status(args);
    case 'proposals':
      return runProposals({
        json: args.json,
        ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
        ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
        limit: args.limit,
        save: args.save,
      });
    case 'serve':
      return runServe({
        ...(args.port !== undefined ? { port: args.port } : {}),
        ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
        ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
      });
    case 'approve':
    case 'reject':
    case 'apply':
    case 'revert':
      if (!args.id) {
        process.stderr.write(`usage: evogen ${args.command} <id>\n`);
        return 1;
      }
      return runLifecycle(args.command, {
        id: args.id,
        ...(args.storePath ? { storePath: args.storePath } : {}),
        ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
        ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
      });
    case 'changes':
      return runChanges({
        id: '',
        ...(args.storePath ? { storePath: args.storePath } : {}),
        ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
        ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
      });
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    case 'version':
      process.stdout.write('0.0.1\n');
      return 0;
    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${USAGE}`);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`evogen failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
