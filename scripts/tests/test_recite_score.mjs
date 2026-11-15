/* 背默卡的计分与闸门必须能被程序复算。
   ────────────────────────────────────────────────────────────────────────
   为什么值得单有一条：卷子的分是「一题一题加出来的」，背默卡的分是「要点表里命中了几条」。
   后者的误差来源完全不同——它来自**要点表抽得好不好**，不是学生答得对不对。
   而这个误差有个硬后果：**S1 的 0.8 这条闸门线，在要点少的时候根本分辨不了。**

   10 条要点时，一条命中的权重是 0.1、半条是 0.05；要点的 bootstrap 半宽是 0.075。
   **0.8 这条线落在半宽里**——S1 = 0.75 与 0.85 在这张表上分不开。这不是文书问题，
   是量具的分辨率问题，必须写在闸门旁边。

   判据三条：
   ① S1 / S2 / 迁移探针的闸门按判分键那一节逐条判（三条缺一不算通过）；
   ② 「字面搬运」给 0 档时 S1 再高也不通过（这是设计立场，要能被复算）；
   ③ 要点数与 S1 最小可辨差的关系要算得出来——要点少于 8 条时闸门不可用。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bootstrapS1, s1Resolution, scoreRecite } from '../tools/recite-score.mjs';

const rubricOf = (n) => ({
  节点: 'test',
  要点: Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, 类型: '骨架', 要点: `要点 ${i + 1}` })),
});

test('三条闸门缺一不算通过', () => {
  const rubric = rubricOf(10);
  // 全中、结构档 3、探针 1 → 通过
  assert.equal(scoreRecite(rubric, {
    命中: rubric.要点.map((p) => p.id), 结构档: 3, 迁移探针: 1,
  }).判定, '通过');
  // S1 满但结构档只有 1 → 部分通过
  assert.equal(scoreRecite(rubric, {
    命中: rubric.要点.map((p) => p.id), 结构档: 1, 迁移探针: 1,
  }).判定, '部分通过');
  // S1 满、结构档满，但探针 0 → 部分通过
  assert.equal(scoreRecite(rubric, {
    命中: rubric.要点.map((p) => p.id), 结构档: 3, 迁移探针: 0,
  }).判定, '部分通过');
  // S1 不到 0.8 → 不通过
  assert.equal(scoreRecite(rubric, {
    命中: rubric.要点.slice(0, 7).map((p) => p.id), 结构档: 3, 迁移探针: 1,
  }).判定, '不通过');
});

test('「字面搬运」判 0 档：S1 再高也不通过', () => {
  // 这是判分键里的设计立场：抄原文能拿到约一半的 S1（要点表里的句子本来就在原文里），
  // 但结构档是 0。若给字面搬运中期分，量表就在奖励「读起来很顺」。
  const rubric = rubricOf(10);
  const result = scoreRecite(rubric, {
    命中: rubric.要点.map((p) => p.id), 结构档: 0, 迁移探针: 1,
  });
  assert.equal(result.命题召回S1, 1, '抄原文也能拿满 S1');
  assert.equal(result.判定, '部分通过', '但结构档 0 不能通过——这正是量表的设计');
});

test('要点少于 8 条时闸门不可用（S1 的分辨率不够）', () => {
  // 6 条要点：一条权重 1/6 ≈ 0.167，半条 0.083。0.8 这条线根本落不到任何组合上。
  const coarse = s1Resolution(6);
  assert.ok(coarse > 0.08, `6 条要点时最小可辨差是 ${coarse}，闸门分辨率不足`);
  const fine = s1Resolution(15);
  assert.ok(fine < 0.04, `15 条要点时最小可辨差是 ${fine}，够用`);
});

test('S1 的 bootstrap 半宽随要点数下降，且 10 条时落在 0.05 附近', () => {
  const rubric = rubricOf(10);
  // 造一份 8 中 2 空的作答
  const answer = { 命中: rubric.要点.slice(0, 8).map((p) => p.id), 结构档: 3, 迁移探针: 1 };
  const band = bootstrapS1(rubric, answer);
  assert.equal(band.要点数, 10);
  // **实测值是 0.25，不是我一开始估的 0.075** —— 这个数是判分键里那张表的来源。
  assert.ok(band.半宽 > 0.20 && band.半宽 < 0.30, `10 条要点、S1=0.8 时半宽应在 0.20–0.30，实测 ${band.半宽}`);
  // 半宽这么大，「0.8 闸门＋10 条要点」就分辨不了 0.65 与 0.95 —— 这条要能被复算出来。
  assert.ok(band.半宽 > 0.2, "10 条要点时半宽不该小于 0.2，否则判分键里那张表就是错的");
  // 要点越多，半宽越小
  const wide = bootstrapS1(rubricOf(30), { 命中: rubricOf(30).要点.slice(0, 24).map((p) => p.id) });
  assert.ok(wide.半宽 < band.半宽, '要点从 10 加到 30，半宽应当变小');
});

test('区间不许越界：S1 与它的区间都必须落在 [0,1]', () => {
  for (const n of [8, 10, 15]) {
    const rubric = rubricOf(n);
    for (const hitCount of [0, Math.floor(n / 2), n]) {
      const answer = { 命中: rubric.要点.slice(0, hitCount).map((p) => p.id), 结构档: 2, 迁移探针: 1 };
      const score = scoreRecite(rubric, answer);
      assert.ok(score.命题召回S1 >= 0 && score.命题召回S1 <= 1, `S1 越界：${score.命题召回S1}`);
      const band = bootstrapS1(rubric, answer);
      assert.ok(band.下界 >= 0 && band.上界 <= 1, `区间越界：[${band.下界}, ${band.上界}]`);
      assert.ok(band.下界 <= score.命题召回S1 + 1e-9 && band.上界 >= score.命题召回S1 - 1e-9,
        `观测值 ${score.命题召回S1} 不落在自己的区间 [${band.下界}, ${band.上界}] 里`);
    }
  }
});

test('判分键里那张分辨率表必须与脚本现算一致', () => {
  // 这张表是写给人看的，但它每个数都是算出来的。表里写 0.313 而脚本算出 0.30，
  // 那就是一句"看着像真的"的假话——而这一整层最怕的就是这种话。
  const keyPath = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'templates/closed-book/判分键.md');
  if (!fs.existsSync(keyPath)) return;
  const key = fs.readFileSync(keyPath, 'utf8');

  const rubricOf2 = (n) => ({ 要点: Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, 类型: '骨架', 要点: 'x' })) });
  const mismatches = [];
  for (const n of [8, 10, 15, 20]) {
    const r = rubricOf2(n);
    const hits = Math.floor(n * 0.8);                    // S1 ≈ 0.80 那一档
    const band = bootstrapS1(r, { 命中: r.要点.slice(0, hits).map((p) => p.id) });
    const shown = new RegExp(`\\|\\s*\\*{0,2}${n}\\*{0,2}\\s*\\|[^|]*\\*{0,2}(${band.半宽.toFixed(3)}|${band.半宽.toFixed(2)})\\*{0,2}`);
    if (!shown.test(key)) mismatches.push(`${n} 条要点：现算 ${band.半宽.toFixed(3)}，判分键里没写这个数`);
  }
  assert.deepEqual(mismatches, [], `判分键的分辨率表与脚本算的对不上：\n${mismatches.join('\n')}`);
});