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
