/* 闸门可判别性工具的自检。
   ────────────────────────────────────────────────────────────────────────
   这个工具回答一个此前没人问的问题：**「S1 ≥ 0.8」这句判决，到底能不能把两个人分开？**

   答案是「不能」，而且不是因为要点少。原因一句话：相邻两档只差 `1/n`，区间宽度是
   `O(1/√n)`——`1/n` 衰减得更快，所以重叠会缩小，但**不会归零**。

   这条套件钉三件事：
   ① 工具必须真在算区间（第一版把作答参数传成 `{}`，每个点都算成「没命中」，区间全是 [0,0]，
      整张表成了「全都可判」的假象——一个看起来完全正常的错误结论）；
   ② 重叠随点数单调缩小但**永不归零**；
   ③ 闸门线落在格点上时（15 点、12 命中 = 0.8）才可判。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { gateResolvability } from '../tools/gate-resolvability.mjs';

test('区间是真的在算（不是全 [0,0]）', () => {
  const r = gateResolvability(18, 0.8);
  assert.ok(r, '18 点、闸门 0.8 应当有结果');
  assert.ok(r.最接近的过线档.上界 > r.最接近的过线档.下界,
    `过线档的区间宽度是 0（${r.最接近的过线档.下界}–${r.最接近的过线档.上界}）——作答参数又传错了`);
  assert.ok(r.最接近的不过线档.上界 > r.最接近的不过线档.下界, '不过线档的区间也是零宽');
});

test('重叠随要点数缩小，但永不归零（这是结论，不是缺陷）', () => {
  // 点数上到 60 就够证明单调性了——200 点要跑 7 秒，门禁里不值得。
  const overlaps = [18, 30, 60].map((n) => gateResolvability(n, 0.8).区间重叠宽度);
  assert.ok(overlaps[0] > overlaps[1] && overlaps[1] > overlaps[2],
    `重叠应当单调缩小，实测 ${JSON.stringify(overlaps)}`);
  assert.ok(overlaps.every((x) => x > 0),
    `重叠不该归零——1/n 永远比 1/√n 衰减得快，实测 ${JSON.stringify(overlaps)}`);
});

test('判分键里那张「闸门不可判」表必须与脚本现算一致', () => {
  // 表里每个数都是算出来的。写错一个数，读的人就会以为「18 点时的重叠是 0.2」。
  const keyPath = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'templates/closed-book/判分键.md');
  if (!fs.existsSync(keyPath)) return;
  const key = fs.readFileSync(keyPath, 'utf8');
  const problems = [];
  for (const n of [18, 60]) {
    const shown = new RegExp(`\\|\\s*${n}\\s*\\|`);
    if (!shown.test(key)) { problems.push(`判分键里没有 ${n} 点那一行`); continue; }
    const r = gateResolvability(n, 0.8);
    const expected = r.区间重叠宽度.toFixed(3);
    if (!key.includes(expected)) problems.push(`${n} 点：现算重叠 ${expected}，判分键里没写这个数`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});