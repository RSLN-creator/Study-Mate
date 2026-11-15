/* 判分键的共用段落必须与骨架一致。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：判分键有两类内容——
     · **这一课专属**：每道题的答案与判分要点；
     · **全篇共用**：计分总则、判定带、半宽与局限、背默卡计分、S1 分辨率。

   第二类只有一处定义（`templates/closed-book/判分键.md`）。但前十四轮我改过骨架三次
   （半宽 ±8 → 14–19 → 6–19、加背默卡计分、加 S1 分辨率、加失败的修法记录），
   **每一次真判分键都停在旧内容上**——成品里没有背默卡计分那一节、半宽还写着 14–19。

   模板对了、成品没跟上，等于没改。这条套件让它不能再发生。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMON_SECTIONS, check } from '../tools/sync-key-common.mjs';
import { SHARED_SECTION, check as checkPaper } from '../tools/sync-paper-common.mjs';

test('每个真判分键的共用段落都与骨架逐字一致', (t) => {
  const problems = check();
  if (problems === null) { t.skip('没有学习工作区'); return; }
  const lines = [];
  for (const p of problems) {
    if (p.missing.length) lines.push(`${p.name}：缺 ${p.missing.join('、')}`);
    if (p.drifted.length) lines.push(`${p.name}：与骨架不同 ${p.drifted.join('、')}`);
  }
  assert.deepEqual(lines, [],
    `判分键的共用段落与骨架不一致（跑 \`node scripts/tools/sync-key-common.mjs --write\` 同步）：\n${lines.join('\n')}`);
});

test('共用段落只有「背默卡计分」那一节整块同步（别的段落里有本课专属内容）', () => {
  // 这条守的是一个**反面的教训**：一开始我把「计分总则」与「分数怎么读」也整段同步，
  // 结果抹掉了三处本课专属口径——
  //   · `0002` 的「本卷允许答得比更深」；
  //   · `0002` 的「分数怎么读」里按「五问与两个词」写的五部分说明；
  //   · `0005` 与 `0002` 各自的「为什么单列迁移线」。
  // 所以同步清单只留一节。这条断言钉住它不再被扩大。
  assert.deepEqual(COMMON_SECTIONS, ['## 背默卡的计分（这张卡没有题，只有要点表）'],
    '同步清单被扩大了——先确认那一节里没有本课专属内容，再改这条断言');
});

test('真卷子的共用节（「什么时候再做一次」）也要与骨架一致', () => {
  // 判分键那边早就有同步工具，卷子这边一直没有。后果是**骨架改了，真卷子全停在旧内容上**：
  //   · `0003` 连这一整节都没有；
  //   · `0005` 与 `0002` 还写着 +1 / +7 / +30，以及那条错的 Cepeda 2008 引用
  //     （第十九轮核原文时改成 +1 / **+11** / +30，骨架改了，真卷子没改）。
  const problems = checkPaper();
  if (problems === null) { return; }   // 没有工作区
  const lines = problems.map((p) => `${p.name}：${p.reason}`);
  assert.deepEqual(lines, [],
    `真卷子的共用节与骨架不一致（跑 \`node scripts/tools/sync-paper-common.mjs --write\`）：\n${lines.join('\n')}`);
});

test('卷子的共用节只同步那一节（每道题都是本课专属）', () => {
  // 这条钉住同步范围不再被扩大：卷子与判分键的结构不同，**只有「什么时候再做一次」是共用的**，
  // 其余每一题都必须是这一课自己的。把它扩大成"整份同步"会把三份卷子削成同一张。
  assert.equal(SHARED_SECTION, '## 什么时候再做一次（这一节是建议，不是日程）',
    '同步范围被改了——先确认卷子里还有没有别的一节是逐字共用的');
});