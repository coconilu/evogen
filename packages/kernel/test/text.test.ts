import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/pipeline/stages/internal/json.js';
import { containsNormalized, normalizeText, similarity } from '../src/pipeline/stages/internal/text.js';

describe('text helpers', () => {
  it('normalizes case, punctuation and whitespace', () => {
    expect(normalizeText('  Always RUN pnpm build!  ')).toBe('always run pnpm build');
  });

  it('scores similar CJK strings high and unrelated ones low', () => {
    expect(similarity('总是使用 pnpm，不要用 npm', '总是使用 pnpm 而不是 npm')).toBeGreaterThan(0.4);
    expect(similarity('总是使用 pnpm', '请用中文回复')).toBeLessThan(0.2);
  });

  it('detects containment across whitespace and punctuation', () => {
    expect(containsNormalized('Always run\npnpm   build.', 'run pnpm build')).toBe(true);
    expect(containsNormalized('unrelated text', 'missing fragment')).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in code fences and prose', () => {
    const text = 'Here you go:\n```json\n{"evidence":[{"kind":"win"}]}\n```\nHope that helps.';
    expect(extractJson(text)).toEqual({ evidence: [{ kind: 'win' }] });
  });

  it('survives braces inside strings', () => {
    expect(extractJson('prefix {"text":"has } brace"} suffix')).toEqual({ text: 'has } brace' });
  });

  it('returns undefined for non-JSON', () => {
    expect(extractJson('no structure here')).toBeUndefined();
  });
});
