/* 待定的拍不许悄悄进规范。
   ────────────────────────────────────────────────────────────────────────
   2026-11-15 发现：`docs/设计/学习方法层.md` 的节拍表里有六拍，但**只有 B0/B2/B3/B8 落进了
   `layered-practice`**；B5（会话组装/交错）与 B6（延迟反馈）一直只在设计文档里。

   查清原因后，这个状态是**对的**——不是漏了，是这两拍的证据站不住：
   · B5：Taylor & Rohrer 2010 / Rohrer 2020 说交错有效，而 Brunmair & Richter 2019 的元分析
     说**说明性文本不显著**（我们课件正是说明性文本）。两条都没自己核过原文。
   · B6：Butler 2007 支持延迟反馈、Adesope 2017 说反馈不显著、Yang 2021 说显著——三方打架。

   **没核过、且互相打架的证据不许写成规则。** 这条套件守住这个状态：
   ① 设计文档里 B5/B6 必须标着「待定」或「证据打架」；
   ② `layered-practice` 里不许出现 B5/B6 的**可执行规则**（提一句"先不要做"是可以的）；
   ③ 已落的四拍（B0/B2/B3/B8）必须都在规范里。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DESIGN = path.join(ROOT, 'docs/设计/学习方法层.md');
const SPEC = path.join(ROOT, 'preset/skills/layered-practice/SKILL.md');

const design = () => fs.readFileSync(DESIGN, 'utf8').replaceAll('\r\n', '\n');
const spec = () => fs.readFileSync(SPEC, 'utf8').replaceAll('\r\n', '\n');

test('设计文档里 B5/B6 必须标着「证据打架 / 待定」', () => {
  const text = design();
  for (const beat of ['B5', 'B6']) {
    const row = text.split('\n').find((line) => line.includes(`**${beat}**`));
    assert.ok(row, `设计文档里找不到 ${beat} 那一行`);
    assert.match(row, /证据打架|待定/, `${beat} 的证据是打架的，那一行必须标出来——不标就会有人照着做`);
  }
});

test('已落的四拍（B0/B2/B3/B8）必须都在规范里', () => {
  const text = spec();
  for (const beat of ['B0', 'B2', 'B3', 'B8']) {
    assert.match(text, new RegExp(`\\*\\*${beat}\\*\\*`), `规范里没有 ${beat} 这一拍`);
  }
});

test('规范里不许出现 B5/B6 的可执行规则（提一句"先不要做"是允许的）', () => {
  // 「可执行规则」的样子是：给出触发条件 + 动作。B5 的触发是「≥3 个同题型族节点」，
  // B6 的触发是「本轮答完后统一给答案」。这两个短句一旦出现在规范里，就说明有人把它当
  // 规则落了——而证据还打架。
  const text = spec();
  const forbidden = [
    ['B5 的交错规则', /≥3 个同题型族节点[^\n]*打乱/],
    ['B6 的延迟反馈规则', /全部答完后统一给答案/],
  ];
  const found = [];
  for (const [name, pattern] of forbidden) {
    if (pattern.test(text)) found.push(name);
  }
  assert.deepEqual(found, [],
    `这些待定的拍被写成规则了：${found.join('、')}——证据还打架，不许落`);
});

test('「先不要做」这个交代必须留在规范里', () => {
  // 只写 B0/B2/B3/B8 而不提 B5/B6，读的人会以为设计文档里那两拍被"漏掉了"，
  // 然后自己补上。所以要有一节明说"这两个先不要做，原因是证据打架"。
  const text = spec();
  assert.match(text, /B5 与 B6/, '规范里要有一节交代 B5/B6 为什么没落');
  assert.match(text, /先不要做|证据.{0,4}打架|站不住/, '并且要说清是"证据站不住"，不是"忘了"');
});
