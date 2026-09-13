import type { Signal } from '../../domain/evidence.js';
import type { Expression, Proposal } from '../../domain/proposal.js';
import type { SurfaceSpec } from '../../domain/surface.js';
import type { PipelineContext } from '../context.js';
import type { Stage } from '../pipeline.js';
import { asRecord, asString, asStringArray, extractJson } from './internal/json.js';
import { containsNormalized, normalizeText } from './internal/text.js';

const MAX_SURFACE_CHARS = 3_000;
const MAX_CONTENT_CHARS = 2_000;

const SYSTEM =
  '你是 AI 编码助手指令文件的维护者。你的职责是把反复出现的信号固化成清晰、可执行的指令条目。' +
  '你只输出 JSON，不输出任何其它文字。';

interface SurfaceContent {
  readonly spec: SurfaceSpec;
  readonly content: string;
}

interface RawExpression {
  readonly surfaceId: string;
  readonly content: string;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
}

function userPrompt(signals: readonly Signal[], surfaces: readonly SurfaceContent[]): string {
  const signalBlock = JSON.stringify(
    signals.map((signal) => ({
      kind: signal.kind,
      statement: signal.statement,
      weight: signal.weight,
      evidenceIds: signal.evidenceIds,
    })),
    null,
    2,
  );
  const surfaceBlock = surfaces
    .map(
      (surface) =>
        `<surface id="${surface.spec.id}" path="${surface.spec.path}">\n${surface.content}\n</surface>`,
    )
    .join('\n');
  return `下面是归并后的信号（来自多个会话的证据）与现有可进化面的内容。请提出建议。

规则：
- 只允许 op=append：在文件末尾追加一个新的带标记块。不要改写、不要删除现有内容；
- content：将要追加的指令文本。使用与目标文件一致的语言，风格与该文件保持一致，简洁、要点式；不要包含 HTML 注释或标记；
- 每条 expression 的 evidenceIds 必须从下方信号给出的证据 id 中选取；
- 不要提出与「现有可进化面内容」语义重复的建议；
- 最多 3 条。没有值得提出的就返回空 expressions。

只输出 JSON：
{"title":"…","expressions":[{"surfaceId":"…","op":"append","content":"…","rationale":"…","evidenceIds":["…"]}]}

信号：
${signalBlock}

现有可进化面：
${surfaceBlock}`;
}

async function loadTargets(ctx: PipelineContext): Promise<readonly SurfaceContent[]> {
  const specs = await ctx.surfaces.list();
  const targets: SurfaceContent[] = [];
  for (const spec of specs) {
    // Skills belong to individual capabilities; general lessons go to
    // instruction/memory surfaces instead.
    if (spec.kind === 'skill') continue;
    targets.push({ spec, content: clip(await ctx.surfaces.read(spec), MAX_SURFACE_CHARS) });
  }
  return targets;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[clipped]` : text;
}

/** Only append survives parsing: M1 generates no replacement suggestions. */
function parseExpressions(payload: unknown): readonly RawExpression[] {
  const root = asRecord(payload);
  const list = Array.isArray(root['expressions']) ? root['expressions'] : [];
  const result: RawExpression[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const surfaceId = asString(record['surfaceId']);
    const content = asString(record['content']).trim();
    if (asString(record['op']) !== 'append') continue;
    if (surfaceId.length === 0 || content.length === 0) continue;
    result.push({
      surfaceId,
      content,
      rationale: asString(record['rationale']).trim(),
      evidenceIds: asStringArray(record['evidenceIds']),
    });
  }
  return result;
}

/** Model-drafted proposal, validated against hard kernel-side rules. */
export function createProposeStage(): Stage<readonly Signal[], Proposal> {
  return {
    name: 'propose',
    async run(signals: readonly Signal[], ctx: PipelineContext): Promise<Proposal> {
      const surfaces = await loadTargets(ctx);
      const knownEvidence = new Set(signals.flatMap((signal) => signal.evidenceIds));
      const existingById = new Map(surfaces.map((surface) => [surface.spec.id, surface.content]));

      let title = '建议';
      let raw: readonly RawExpression[] = [];
      if (signals.length > 0) {
        try {
          const response = await ctx.model.complete({
            system: SYSTEM,
            prompt: userPrompt(signals, surfaces),
            responseFormat: 'json',
          });
          const payload = asRecord(extractJson(response.text));
          title = asString(payload['title']).trim() || title;
          raw = parseExpressions(payload);
        } catch {
          raw = [];
        }
      }

      const validEvidence = (ids: readonly string[]) => ids.filter((id) => knownEvidence.has(id));

      const expressions: Expression[] = [];
      const seenContent = new Set<string>();
      for (const item of raw) {
        const existing = existingById.get(item.surfaceId);
        if (existing === undefined) continue; // unknown surface
        if (item.content.length > MAX_CONTENT_CHARS) continue;
        // Hard dedup, independent of the model's good intentions.
        if (containsNormalized(existing, item.content)) continue;
        const key = `${item.surfaceId}:${normalizeText(item.content).slice(0, 160)}`;
        if (seenContent.has(key)) continue;
        seenContent.add(key);
        const evidenceIds = validEvidence(item.evidenceIds);
        // Traceability is a hard rule: an expression that cannot point back at
        // evidence is not allowed to become a proposal.
        if (evidenceIds.length === 0) continue;
        expressions.push({
          id: ctx.ids.next('exp'),
          surfaceId: item.surfaceId,
          op: 'append',
          payload: { content: item.content },
          rationale: item.rationale,
          evidenceIds,
        });
      }

      const usedEvidence = new Set(expressions.flatMap((expression) => expression.evidenceIds));
      const usedSignals = signals.filter((signal) => signal.evidenceIds.some((id) => usedEvidence.has(id)));

      return {
        id: ctx.ids.next('prop'),
        createdAt: ctx.clock.now().toISOString(),
        title,
        status: 'draft',
        signals: usedSignals,
        expressions,
      };
    },
  };
}
