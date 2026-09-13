/**
 * Small line diff, good enough for previews: changed lines with a couple of
 * unchanged lines of context, `…` marking elided regions.
 */
export function renderDiff(before: string, after: string, context = 2): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = toOps(a, b);

  const included = new Set<number>();
  ops.forEach((op, index) => {
    if (op.type === 'same') return;
    for (let i = Math.max(0, index - context); i <= Math.min(ops.length - 1, index + context); i += 1) {
      included.add(i);
    }
  });

  const lines: string[] = [];
  let index = 0;
  while (index < ops.length) {
    if (!included.has(index)) {
      index += 1;
      continue;
    }
    if (index > 0 && !included.has(index - 1)) lines.push('  …');
    while (index < ops.length && included.has(index)) {
      const op = ops[index];
      if (!op) break;
      if (op.type === 'same') lines.push(`  ${op.text}`);
      else if (op.type === 'remove') lines.push(`- ${op.text}`);
      else lines.push(`+ ${op.text}`);
      index += 1;
    }
    if (index < ops.length) lines.push('  …');
  }
  return lines.join('\n');
}

type Op = { readonly type: 'same' | 'remove' | 'add'; readonly text: string };

/** Splits into lines, treating one trailing newline as a line terminator. */
function splitLines(text: string): string[] {
  const lines = text.length === 0 ? [] : text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Indexed access that fails loudly instead of leaking undefined. */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`index ${index} out of bounds`);
  return value;
}

function lcsTable(a: readonly string[], b: readonly string[]): readonly (readonly number[])[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        at(a, i) === at(b, j) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

function toOps(a: readonly string[], b: readonly string[]): Op[] {
  const lcs = lcsTable(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (at(a, i) === at(b, j)) {
      ops.push({ type: 'same', text: at(a, i) });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'remove', text: at(a, i) });
      i += 1;
    } else {
      ops.push({ type: 'add', text: at(b, j) });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ type: 'remove', text: at(a, i) });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: at(b, j) });
    j += 1;
  }
  return ops;
}
