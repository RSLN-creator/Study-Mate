/* 评分者一致性工具的自检：ICC 与 α 都不能退化。
   ────────────────────────────────────────────────────────────────────────
   为什么值得单有一条：这两个统计量是「判分键能不能用」的唯一凭据。它们算错的样子很难看
   出来——第一版 ICC 漏了一步归一，用三份差很大的评分跑出 **49.5**，而 ICC 不可能大于 1。
   一个越界但"看起来像个数"的值，比报错危险得多。

   判据三条：
   ① 完全一致的评分 → ICC = 1、α = 1（上限必须摸得到）；
   ② 分歧很大的评分 → ICC 要么在 [−1,1] 内、要么明确拒绝给值（不许给出越界的数），α 要低；
   ③ 缺失值不当作 0（当作缺失），且不影响 α 的计算。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { icc2k, krippendorffAlpha, perItemSpread, readRatings, alphaVerdict } from '../tools/rater-agreement.mjs';

const csv = (rows) => ['题号,满分,rater-a,rater-b,rater-c', ...rows].join('\n');

test('完全一致的评分：ICC = 1，α = 1（上限摸得到）', () => {
  const { rows } = readRatings(csv([
    '1,6,6,6,6',
    '2,6,5,5,5',
    '3,8,4,4,4',
    '4,9,7,7,7',
  ]));
  assert.equal(icc2k(rows).icc, 1);
  assert.equal(krippendorffAlpha(rows).alpha, 1);
});

test('分歧很大：ICC 要么在范围内、要么拒绝给值；不许给出越界的数', () => {
  // 这条是反证。第一版在这里跑出 49.5。
  const { rows } = readRatings(csv([
    '1,6,6,2,0',
    '2,6,5,1,6',
    '3,8,4,8,0',
    '4,9,9,2,3',
  ]));
  const { icc } = icc2k(rows);
  if (icc !== null) {
    assert.ok(icc >= -1 && icc <= 1, `ICC 越界了：${icc}——公式有错，不能把这个数报出去`);
  }
  const alpha = krippendorffAlpha(rows).alpha;
  assert.ok(alpha !== null && alpha < 0.667, `分歧这么大，α 不该达到可用水平：${alpha}`);
  assert.equal(alphaVerdict(alpha), '不可用');
});

test('完全一致的评分不许被浮点误差判成「公式有问题」', () => {
  // 实测踩过的坑：复评后三位评分者 13 题逐题完全一致，ICC 却报 null——因为残差均方为 0 时
  // 算出来是 1.0000000001，被 [−1,1] 的硬边界拒绝。**最好的数据被判成最坏的情况。**
  // 现在有 1e-9 容差，且结果夹回 [−1,1]。
  const { rows } = readRatings(csv([
    '1,6,0,0,0', '2,6,6,6,6', '3,8,8,8,8', '4,8,7,7,7',
    '5,9,9,9,9', '6,9,6,6,6', '7,9,7.5,7.5,7.5',
  ]));
  assert.equal(icc2k(rows).icc, 1, '三人完全一致时 ICC 必须正好是 1，不能是 null');
});

test('α 的判读阈值按 Krippendorff 2004：0.80 / 0.667 两条线', () => {
  assert.equal(alphaVerdict(0.85), '可下结论');
  assert.equal(alphaVerdict(0.8), '可下结论');
  assert.equal(alphaVerdict(0.75), '只能作暂定结论');
  assert.equal(alphaVerdict(0.667), '只能作暂定结论');
  assert.equal(alphaVerdict(0.5), '不可用');
  assert.equal(alphaVerdict(null), '不可判');
});

test('缺失值当成缺失，不当成 0', () => {
  // 第 2 题 rater-c 空着：ICC 只用完整行；α 用可得的那几对。
  const { rows } = readRatings(csv([
    '1,6,6,6,6',
    '2,6,5,5,',
    '3,8,4,4,4',
  ]));
  assert.equal(rows[1].分[2], null, '空单元要读成 null，不能读成 0');
  const alpha = krippendorffAlpha(rows).alpha;
  assert.ok(alpha !== null && alpha > 0.9, `缺失不该把一致性拖低：${alpha}`);
});

test('逐题极差能把分歧最大的题排到最前面', () => {
  const { rows } = readRatings(csv([
    '1,6,6,6,6',
    '2,6,6,1,1',
    '3,8,4,4,3',
  ]));
  const spread = perItemSpread(rows);
  assert.equal(spread[0].题号, '2');
  assert.equal(spread[0].极差, 5);
});
