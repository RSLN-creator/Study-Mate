/* 使用说明里必须有「自己做一次检验」那一节，且关键内容一件不少。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：前面二十六轮做的所有东西（卷子 / 判分键 / 背默卡 / 检验记录 / 锚点数据集 /
   五套工具），**在 `docs/使用/使用说明.md` 里一个字都没有提到**。
   一个学生读完使用说明，不会知道"考考我"存在。

   **没有使用说明，等于没做。**

   这条套件钉六件事——每一件都是这二十六轮反复撞出来的：
   ① 这一节在，且能搜到「考考我」；
   ② 写清了「被试必须是人」，而不是模型代做；
   ③ 写清了「判分键不在参考资料里」——那是故意不让学生顺手点开的；
   ④ 顺序是 3R（读一遍 → 立刻回忆 → 带缺口重读 → 再回忆），不是「读两三遍再背」；
   ⑤ 三条局限都在，且明说差 19 分以内不算真实差异；
   ⑥ 明说节拍不是日程。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GUIDE = path.join(ROOT, 'docs/使用/使用说明.md');
const read = () => fs.readFileSync(GUIDE, 'utf8').replaceAll('\r\n', '\n');

test('使用说明里有「自己做一次检验」这一节', () => {
  const text = read();
  assert.match(text, /## 六、自己做一次检验/, '使用说明里没有这一节——学生读完不知道「考考我」存在');
  assert.match(text, /考考我/, '要给出触发词');
});

test('写清了「被试必须是人」', () => {
  const text = read();
  assert.match(text, /只有人能做|模型不做|被试必须是人/, '要写明这一步模型不做');
  assert.match(text, /模型不会忘|测的是"改写"不是"提取"/, '要说清为什么模型不能做——它不会忘');
});

test('写清了判分键不在参考资料里，且说明是故意的', () => {
  const text = read();
  assert.match(text, /判分键不在阅读端的「参考资料」里/, '要明说位置');
  assert.match(text, /那是故意的|故意的/, '要说清这不是漏了，是设计');
});

test('顺序是 3R，不是「读两三遍再背」', () => {
  const text = read();
  assert.match(text, /不是「读两三遍再背」|不是"读两三遍再背"/, '要点名旧顺序是错的');
  assert.match(text, /读一遍/, '第 1 步是读一遍');
  assert.match(text, /带缺口重读/, '第 3 步是带缺口重读');
  assert.match(text, /两次都要闭卷/, '要强调两次都闭卷');
});

test('三条局限都在，且明说 19 分这条线', () => {
  const text = read();
  assert.match(text, /分不出"没想起来"与"没学会"/, '第一条：一次性施测');
  assert.match(text, /6–19 分/, '第二条：半宽');
  assert.match(text, /差 19 分以内不要当成真实差异/, '第二条要给出具体用法');
  assert.match(text, /可能漏掉了有价值但没出题的部分/, '第三条：产物可能漏');
});

test('明说节拍不是日程', () => {
  const text = read();
  assert.match(text, /不是日程/, '要说清那是建议不是排期');
  assert.match(text, /系统不会来提醒你|没有"到期"字段/, '要说明系统不做提醒');
});

test('旧顺序不许原样留着（反证）', () => {
  // 骨架那边栽过一次：方法文档推翻了「读两三遍再背默」，骨架还在写它。
  // 这条防止使用说明也写回旧顺序。
  const text = read();
  assert.doesNotMatch(text, /先把.{0,10}读两三遍。读的过程中/, '这一句是旧顺序的原文，不该出现');
});
