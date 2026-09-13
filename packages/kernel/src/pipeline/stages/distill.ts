import type { Evidence, EvidenceKind } from '../../domain/evidence.js';
import type { RawSession } from '../../domain/session.js';
import type { PipelineContext } from '../context.js';
import type { Stage } from '../pipeline.js';
import { asNumber, asRecord, asString, extractJson } from './internal/json.js';
import { clamp01, containsNormalized, normalizeText } from './internal/text.js';
import { renderTranscript } from './internal/transcript.js';

const KINDS: readonly EvidenceKind[] = ['correction', 'repetition', 'failure', 'preference', 'win'];

const SYSTEM =
  '你是工程会话分析器，负责从 AI 编码助手的会话记录中找出值得沉淀为长期指令的片段。' +
  '你只输出 JSON，不输出任何其它文字。';

function userPrompt(transcript: string): string {
  return `下面是一段 AI 编码助手与用户的会话记录。找出其中值得沉淀为助手长期指令的证据。

每条证据必须满足：
- kind 取其一：correction（用户纠正了助手的做法）、repetition（同一偏好或问题重复出现）、failure（任务失败或走弯路）、preference（用户明确表达的偏好）、win（特别有效、值得固化的做法）；
- quote：必须是会话记录中原样出现的连续片段，不要改写、不要拼接、不要缩写；
- note：一句话说明这条证据指向什么规则；
- confidence：0 到 1 的小数。

没有值得沉淀的内容就返回空数组；宁缺毋滥，不确定的不要输出。
只输出 JSON：{"evidence":[{"kind":"correction","quote":"…","note":"…","confidence":0.8}]}

会话记录：
${transcript}`;
}

interface RawEvidence {
  readonly kind: EvidenceKind;
  readonly quote: string;
  readonly note: string;
  readonly confidence: number;
}

function parseEvidence(payload: unknown, transcript: string): readonly RawEvidence[] {
  const root = asRecord(payload);
  const list = Array.isArray(root['evidence']) ? root['evidence'] : [];
  const seen = new Set<string>();
  const result: RawEvidence[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const kind = asString(record['kind']) as EvidenceKind;
    const quote = asString(record['quote']).trim();
    const note = asString(record['note']).trim();
    if (!KINDS.includes(kind) || quote.length === 0 || note.length === 0) continue;
    // Traceability rule: the quote must really occur in the transcript, or the
    // evidence cannot be trusted to point back at a session fragment.
    if (!containsNormalized(transcript, quote)) continue;
    const key = `${kind}:${normalizeText(quote).slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind, quote, note, confidence: clamp01(asNumber(record['confidence']) || 0.5) });
  }
  return result;
}

/** Turns sessions into evidence, one model call per session. */
export function createDistillStage(): Stage<readonly RawSession[], readonly Evidence[]> {
  return {
    name: 'distill',
    async run(sessions: readonly RawSession[], ctx: PipelineContext): Promise<readonly Evidence[]> {
      const evidence: Evidence[] = [];
      for (const session of sessions) {
        const transcript = renderTranscript(session);
        let payload: unknown;
        try {
          const response = await ctx.model.complete({
            system: SYSTEM,
            prompt: userPrompt(transcript),
            responseFormat: 'json',
          });
          payload = extractJson(response.text);
        } catch {
          continue; // one unreadable session must not sink the run
        }
        for (const raw of parseEvidence(payload, transcript)) {
          evidence.push({
            id: ctx.ids.next('ev'),
            sessionId: session.ref.id,
            kind: raw.kind,
            quote: raw.quote,
            note: raw.note,
            confidence: raw.confidence,
          });
        }
      }
      return evidence;
    },
  };
}
