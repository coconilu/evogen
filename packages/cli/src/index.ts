#!/usr/bin/env node
import { createCodexAdapter } from '@evogen/adapter-codex';

const USAGE = `evogen — session-driven self-evolution for AI coding agents

Usage:
  evogen status [--json] [--all] [--project <dir>] [--sessions <dir>]
  evogen help
  evogen version

Commands:
  status    Read-only. Lists the surfaces this runtime can evolve and how many
            sessions are available. Writes nothing, opens no network.

Options:
  --json             Machine-readable output.
  --all              List every skill surface instead of the first few.
  --project <dir>    Project root that owns the instruction file (default: cwd).
  --sessions <dir>   Session log directory (default: the host's own store).

What is not here yet:
  M1 adds \`evogen proposals\` (evidence -> signals -> proposals, dry-run diffs).
  M2 adds \`evogen apply\` / \`evogen revert\`. See docs/roadmap.md.
`;

interface Args {
  readonly command: string;
  readonly json: boolean;
  readonly all: boolean;
  readonly projectRoot: string | undefined;
  readonly sessionsRoot: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let json = false;
  let all = false;
  let projectRoot: string | undefined;
  let sessionsRoot: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--all') {
      all = true;
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

  return { command: positional[0] ?? 'status', json, all, projectRoot, sessionsRoot };
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
  lines.push('next: M1 adds `evogen proposals`. See docs/roadmap.md.');

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'status':
      return status(args);
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
