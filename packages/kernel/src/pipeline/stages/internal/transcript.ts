import type { RawSession } from '../../../domain/session.js';

const MAX_TRANSCRIPT_CHARS = 24_000;

/** Renders turns into the compact, role-tagged text the model gets to see. */
export function renderTranscript(session: RawSession): string {
  const lines: string[] = [];
  for (const turn of session.turns) {
    if (turn.role === 'tool') {
      lines.push(`[tool:${turn.tool ?? 'unknown'}] ${turn.result ?? ''}`);
    } else if (turn.role === 'assistant' && turn.tool !== undefined) {
      lines.push(`[assistant:call ${turn.tool}] ${turn.args ?? ''}`);
    } else {
      lines.push(`[${turn.role}] ${turn.text ?? ''}`);
    }
  }
  const text = lines.join('\n');
  return text.length > MAX_TRANSCRIPT_CHARS
    ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n…[clipped]`
    : text;
}
