/* 讲法体检的分辨力校验：每条判据都要有「正例不报、反例必报」的一对样例。
 *
 * 为什么必须有：这六条判据的阈值（4000 字、3 个符号、类比断点句式）都是工程约定，
 * 没有这条套件，「体检」就只是一堆正则，谁也不知道它报的是不是真问题。
 * 第一版实测就被它抓到两次假警报：表格 4 列被当成「并列罗列」、`\frac` 被当成符号。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { inspect } from '../tools/lesson-style-check.mjs';

const hits = (markdown, criterion) => inspect(markdown).filter((item) => item.判据 === criterion);

test('起笔：概括句进报告，具体场景不进', () => {
  const generic = '## 甲\n\n本节介绍视场角与焦距的关系，并给出三条式子。\n\n内容。\n\n## 乙\n\n具体。\n';
  const concrete = '## 甲\n\n桌上摆着两台候选机器，两份 datasheet 上都印着跟「距离」有关的数字。\n\n内容。\n';
  assert.equal(hits(generic, '起笔').length, 1);
  assert.equal(hits(concrete, '起笔').length, 0);
});

test('回收：起笔有疑问而末段不回指时报警，回指时不报', () => {
  const noBackref = '## 甲\n\n这个数从哪儿来？\n\n第一段讲完了。\n\n第二段讲完了。\n';
  const backref = '## 甲\n\n这个数从哪儿来？\n\n第一段讲完了。\n\n回到开头那个疑问，它来自靶面宽的两种取法。\n';
  assert.equal(hits(noBackref, '回收').length, 1);
  assert.equal(hits(backref, '回收').length, 0);
});

test('篇幅：4000 字是线，3999 不报、4001 报', () => {
  const make = (n) => `## 甲\n\n${'字'.repeat(n)}\n`;
  assert.equal(hits(make(3999), '篇幅').length, 0);
  assert.equal(hits(make(4001), '篇幅').length, 1);
});

test('并列：只看标题，不数表格列（4 列表不该被当成并列罗列）', () => {
  const table = '## 甲\n\n| 项 | A | B | C |\n| --- | --- | --- | --- |\n| x | 1 | 2 | 3 |\n';
  const enumerated = '## 反解焦距的三种等价写法\n\n内容。\n';
  assert.equal(hits(table, '并列').length, 0, '多列表格是好事，不该报');
  assert.equal(hits(enumerated, '并列').length, 1);
});

test('符号：LaTeX 命令不算符号，真符号超三个要报', () => {
  // 单符号的块级公式：若把 \frac 与 \cdot 也算成符号，这里就会被误报
  const latexOnly = '## 甲\n\n$$R=\\frac{U}{I}$$\n\n正文。\n';
  assert.equal(hits(latexOnly, '符号').length, 0,
    '\\frac 与 \\cdot 是排版指令，不是符号；R、U、I 三个符号没超线');

  // 四个真符号：要报，且报出的**数量只数真符号**（W、w、D、f），不含 LaTeX 命令
  const flood = '## 甲\n\n$$W=\\frac{w \\cdot D}{f}$$\n\n正文。\n';
  const reported = hits(flood, '符号');
  assert.equal(reported.length, 1);
  assert.match(reported[0].说, /4 个符号/);
  assert.doesNotMatch(reported[0].说, /frac|cdot/);

  // 六个真符号：数量要数对
  const more = '## 甲\n\n这里有 $W$、$w$、$D$、$f$ 四个量，还有 $N$ 与 $p$。\n';
  assert.match(hits(more, '符号')[0].说, /6 个符号/);
});

test('符号：已经做过具体计算之后不再报警（先算再给符号是允许的）', () => {
  const calculatedFirst = '## 甲\n\n先算一个数：$7.424 \\times 40000 \\div 32 = 9280$。\n\n有了这个数，再说 $W$、$w$、$D$、$f$ 与 $N$。\n';
  assert.equal(hits(calculatedFirst, '符号').length, 0);
});

test('类比：没有断点声明要报，带断点声明不报', () => {
  const bare = '## 甲\n\n电流就像水流一样，从电源流向电阻。\n\n然后讲别的。\n';
  const withBreak = '## 甲\n\n电流就像水流一样，从电源流向电阻。但它只在这一处成立：剪断导线电流不会像水一样漏出来。\n';
  assert.equal(hits(bare, '类比').length, 1);
  assert.equal(hits(withBreak, '类比').length, 0);
});

test('固定收尾（原文在哪儿 / 三句要能说出来）不进体检', () => {
  const markdown = '## 甲\n\n内容。\n\n## 原文在哪儿\n\n| 序号 | 名称 |\n| --- | --- |\n\n## 三句要能说出来\n\n- 一句话。\n';
  assert.equal(inspect(markdown).length, 0);
});
