import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRequiredCheck, releaseTag, releaseTarget } from './release-target.mjs';

const sha = 'a'.repeat(40);
const repository = { default_branch: 'main', full_name: 'owner/repo' };
test('手动升级版本等待自动准备结果，随后发布合并提交；none 使用触发提交', () => {
  assert.equal(
    releaseTarget('workflow_dispatch', { repository, inputs: { bump: 'patch' } }, sha, 'refs/heads/main'),
    null,
  );
  assert.equal(
    releaseTarget('workflow_dispatch', { repository, inputs: { bump: 'none' } }, sha, 'refs/heads/main').sha,
    sha,
  );
  assert.throws(() =>
    releaseTarget('workflow_dispatch', { repository, inputs: { bump: 'none' } }, sha, 'refs/heads/feature'),
  );
});
test('发布目标只有提交号；版本号必须两处一致', () => {
  const event = {
    repository,
    action: 'closed',
    issue: { number: 7, state_reason: 'completed' },
  };
  assert.throws(() => releaseTarget('issues', event, sha));
  assert.deepEqual(
    releaseTarget('workflow_dispatch', { repository, inputs: { bump: 'none' } }, sha, 'refs/heads/main'),
    { sha },
  );
  assert.equal(releaseTag('1.2.3', '1.2.3'), 'v1.2.3');
  assert.throws(() => releaseTag('1.2.3', '1.2.4'));
  assert.throws(() => releaseTag('1.2', '1.2'));
});
test('只接受 GitHub Actions 最新的 node 与 desktop 检查成功，不接受旧成功/第三方同名/跳过', () => {
  const success = (name, id) => ({
    id,
    name,
    app: { id: 15368 },
    status: 'completed',
    conclusion: 'success',
  });
  assert.equal(hasRequiredCheck([success('node', 1), success('desktop', 2)]), true);
  assert.equal(hasRequiredCheck([success('node', 1), success('desktop', 2), success('node', 3)]), true);
  assert.equal(hasRequiredCheck([success('node', 1)]), false); // desktop missing
  assert.equal(hasRequiredCheck([success('desktop', 1)]), false); // node missing
  assert.equal(hasRequiredCheck([success('node', 1), { ...success('desktop', 2), app: { id: 123 } }]), false);
  assert.equal(
    hasRequiredCheck([
      success('node', 1),
      success('desktop', 2),
      { ...success('node', 3), conclusion: 'failure' },
    ]),
    false,
  );
  assert.equal(
    hasRequiredCheck([success('node', 1), { ...success('desktop', 2), conclusion: 'skipped' }]),
    false,
  );
  assert.equal(hasRequiredCheck([]), false);
});
