import type { Expression, Proposal } from '../../domain/proposal.js';
import type { PipelineContext } from '../context.js';
import type { Stage } from '../pipeline.js';
import { asNumber, asRecord, asString, asStringArray, extractJson } from './internal/json.js';
import { clamp01, containsNormalized } from './internal/text.js';

const SYSTEM =
  '你是严格的自检者，在建议写入指令文件之前审查它。宁可保守：有疑问就放弃对应条目。' +
  '你只输出 JSON，不输出任何其它文字。';

function userPrompt(proposal: Proposal, surfaceContents: ReadonlyMap<string, string>): string {
  const surfaceBlock = [...surfaceContents.entries()]
    .map(([id, content]) => `<surface id="${id}">\n${content}\n</surface>`)
    .join('\n');
  const proposalBlock = JSON.stringify(
    {
      title: proposal.title,
      expressions: proposal.expressions.map((expression) => ({
        id: expression.id,
        surfaceId: expression.surfaceId,
        op: expression.op,
        content: expression.payload.content,
        rationale: expression.rationale,
        evidence: expression.evidenceIds,
      })),
    },
    null,
    2,
  );
  return `对待写入的建议做自检。评估每一条 expression：
- 是否与现有内容语义重复或冲突；
- 是否含糊到无法执行（好指令应当是具体、可核对的行为规则）；
- 是否越权（涉及超出指令维护范围的事，比如改代码、删文件、联网）。

输出：
- risk：0 到 1，越大越危险；
- confidence：0 到 1，越大越确信这些追加会改善后续会话；
- notes：一句话说明判断依据；
- drop：应当放弃的 expression id 列表；
- revise：需要改写的条目，content 仍然只能是要追加的文本。

只输出 JSON：{"risk":0.2,"confidence":0.8,"notes":"…","drop":[],"revise":[{"id":"…","content":"…"}]}

建议：
${proposalBlock}

现有可进化面内容：
${surfaceBlock}`;
}

/** Model self-review; on any failure the proposal survives with a cautious default. */
export function createCritiqueStage(): Stage<Proposal, Proposal> {
  return {
    name: 'critique',
    async run(proposal: Proposal, ctx: PipelineContext): Promise<Proposal> {
      const contents = new Map<string, string>();
      for (const expression of proposal.expressions) {
        if (contents.has(expression.surfaceId)) continue;
        const spec = (await ctx.surfaces.list()).find((surface) => surface.id === expression.surfaceId);
        contents.set(expression.surfaceId, spec ? await ctx.surfaces.read(spec) : '');
      }

      let risk = 0.5;
      let confidence = 0.4;
      let notes = 'critique unavailable; proposal left unchanged.';
      let drop = new Set<string>();
      const revise = new Map<string, string>();

      try {
        const response = await ctx.model.complete({
          system: SYSTEM,
          prompt: userPrompt(proposal, contents),
          responseFormat: 'json',
        });
        const payload = asRecord(extractJson(response.text));
        risk = clamp01(asNumber(payload['risk']) || 0.5);
        confidence = clamp01(asNumber(payload['confidence']) || 0.4);
        notes = asString(payload['notes']).trim() || notes;
        drop = new Set(asStringArray(payload['drop']));
        const reviseList = Array.isArray(payload['revise']) ? payload['revise'] : [];
        for (const item of reviseList) {
          const record = asRecord(item);
          const id = asString(record['id']);
          const content = asString(record['content']).trim();
          if (id.length > 0 && content.length > 0) revise.set(id, content);
        }
      } catch {
        // fall through with the cautious default
      }

      const expressions: Expression[] = [];
      for (const expression of proposal.expressions) {
        if (drop.has(expression.id)) continue;
        let content = expression.payload.content;
        const revised = revise.get(expression.id);
        if (revised !== undefined) {
          const existing = contents.get(expression.surfaceId) ?? '';
          if (!containsNormalized(existing, revised)) content = revised; // a revision may not sneak in duplicates either
        }
        expressions.push({ ...expression, payload: { content } });
      }

      return { ...proposal, expressions, critique: { risk, confidence, notes } };
    },
  };
}
