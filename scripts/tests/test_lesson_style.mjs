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

test('回收：回指不只「回到开头」一种写法（逐条溯源也算）', () => {
  // 实测踩过的坑：`0018-exp-3` 那一节的末段是「它们都是前面几课挣来的」，下面逐条写
  // 「这一句来自第 8 课」「第 16 课补的」——那是回收，但只认「回到/开头」就漏了。
  const bySource = '## 甲\n\n先看范本，再看要填的空白卡。\n\n内容。\n\n范本里有三处值得留意，它们都是前面几课挣来的：\n\n- 这一句来自第 8 课。\n';
  assert.equal(hits(bySource, '回收').length, 0, '逐条溯源是回收的一种');

  const byReference = '## 甲\n\n这个数从哪儿来？\n\n内容。\n\n上文已经交代过它的两处出处。\n';
  assert.equal(hits(byReference, '回收').length, 0);
});

test('回收：泛词不能当回指（「第一段」出现不等于「回到第一段」）', () => {
  // 实测踩过的坑：把 `第一段` 单独放进回指词表，负例里写着「第一段。」就当场失效——
  // 判据变成恒真，反证根本报不出来。回指要说的是**回到**第一段。
  const withWordOnly = '## 甲\n\n这个数从哪儿来？\n\n第一段。\n\n第二段。\n';
  assert.equal(hits(withWordOnly, '回收').length, 1, '「第一段」本身不是回指');
  const realBackref = '## 甲\n\n这个数从哪儿来？\n\n第一段。\n\n回到开头那个疑问，它来自靶面宽的两种取法。\n';
  assert.equal(hits(realBackref, '回收').length, 0);
});

test('回收：起笔不是提问就不要求回收（场景描述不构成承诺）', () => {
  const scene = '## 甲\n\n桌上摆着两台候选机器，两份 datasheet 上都印着跟「距离」有关的数字。\n\n内容。\n\n另一段。\n';
  assert.equal(hits(scene, '回收').length, 0);
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

test('并列：标题写 N 个但已经用 ### 拆开 / 节首给了总表的，都不报', () => {
  // 实测踩过的两个坑：`0010-talk-ready` 的「五段各自要说什么」用五个 `###` 分开了；
  // `0001-intro` 的「三条会让采购填错的读法」先一句引子、再来一张两列表三行——
  // 那正是规范里说的「节首给一张总表」。
  const split = '## 五段各自要说什么\n\n### 第 1 段\n\n内容。\n\n### 第 2 段\n\n内容。\n\n### 第 3 段\n\n内容。\n';
  assert.equal(hits(split, '并列').length, 0, '已经用 ### 拆开了');

  const withLeadTable = '## 三条读法\n\n上面这些数能证伪三句流传很广的话。\n\n| 话 | 为什么错 |\n| --- | --- |\n| 甲 | 一 |\n| 乙 | 二 |\n| 丙 | 三 |\n\n收尾一句。\n';
  assert.equal(hits(withLeadTable, '并列').length, 0, '节首给了总表');

  const notSplit = '## 五段各自要说什么\n\n一段铺到底，没拆也没表。\n';
  assert.equal(hits(notSplit, '并列').length, 1, '既没拆也没总表要报');
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
  assert.match(reported[0].说, /4 个首次出现的符号/);
  assert.doesNotMatch(reported[0].说, /frac|cdot/);

  // 六个真符号：数量要数对
  const more = '## 甲\n\n这里有 $W$、$w$、$D$、$f$ 四个量，还有 $N$ 与 $p$。\n';
  assert.match(hits(more, '符号')[0].说, /6 个首次出现的符号/);
});

test('符号：下标里的文字不算独立符号（k_{B}T 是两符号，不是四符号）', () => {
  // 实测踩过的坑：第一版按 `[A-Za-z]+` 逐词抽，把 `k_{\text{B}}T` 数成 k、B、T 三个，
  // `L_{\text{d}}` 数成 L、d 两个——一段的符号数虚增近一倍，真该报的节反而显得不可信。
  const withSubscripts = '## 甲\n\n式中的 $k_{\\text{B}}T$ 与 $L_{\\text{d}}=\\sqrt{D\\tau}$ 都是符号。\n';
  const reported = hits(withSubscripts, '符号');
  assert.equal(reported.length, 1);
  assert.match(reported[0].说, /4 个首次出现的符号/,
    'k、T、L、D 四个；\\text{B} 与 \\text{d} 是下标文字，\\sqrt 与 \\tau 是排版指令');
  assert.doesNotMatch(reported[0].说, /\\text|\\sqrt/, '也不该把 LaTeX 命令列进去');
});

test('符号：只数「首次出现」——同一符号在后面某节复用不算新进', () => {
  // 实测踩过的坑：判据的原话是「新符号出现的那一段」，第一版按「这一段里出现了几个符号」
  // 数，于是 `0003-carrier-current` 的复算卡（D、k、T、q 全在 §2 的表里交代过）被误报。
  const reused = [
    '## 甲',
    '',
    '这里先算一个数：$7.68 \\times 40 \\div 32 = 9.60$。',
    '',
    '交代 $D$、$k$、$T$、$q$ 四个量。',
    '',
    '## 乙',
    '',
    '练习卡：用 $D$、$k$、$T$、$q$ 算一遍。',
    '',
  ].join('\n');
  const reported = hits(reused, '符号');
  assert.equal(reported.length, 0, '§乙 里的四个符号在 §甲 已经出现过，不该算新进');

  // 反证：同一段里四个**首次**出现的符号仍然要报
  const fresh = '## 甲\n\n还没算过任何数，就来了 $D$、$k$、$T$、$q$ 四个量。\n';
  assert.equal(hits(fresh, '符号').length, 1);
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

test('类比：数值换算不算类比（「1.8 kN 相当于 180 kg」不是结构映射）', () => {
  // 实测踩过的坑：`0008-paper1-hotpress` 有两处「相当于」，一处是「1.8 kN，相当于
  // 180 kg 的重物压着它」（换算，不可能产生 misconception），一处是「作用相当于给一个
  // 相发的身份证号」（结构类比，要断点声明）。第一版不区分，两处都报。
  const numeric = '## 甲\n\n压力值得算一下：10 MPa 摊在 φ15 mm 的圆上约 1.8 kN，相当于 180 kg 的重物压着它。\n';
  assert.equal(hits(numeric, '类比').length, 0, '换算不是类比');

  const structural = '## 甲\n\n这两串数字的作用相当于给一个相发的身份证号。\n\n然后讲别的。\n';
  assert.equal(hits(structural, '类比').length, 1, '结构类比要报');
});

test('并列：一张图也能当总表（不是只有管道表才算）', () => {
  // 实测踩过的坑：`0016-stability` 的「三条通道一张表」用的是 `::: svg` 三行链条图，
  // 每一行一条通道，节内再逐条展开差异——那正是「节首给一张总表」，只是载体是图。
  const withFigure = '## 三条通道一张表\n\n::: svg\nalt: 三行链条图\ncaption: 三条通道各有一个驱动量\n\n<svg viewBox="0 0 10 10"></svg>\n:::\n\n逐条展开。\n';
  assert.equal(hits(withFigure, '并列').length, 0, '图承担了总表');
});

test('符号：全部当场带单位的，不算堆砌', () => {
  // 实测踩过的坑：`0012-exp-1` 的「三栏各装什么」一段里 R 跟 A/W、EQE 跟 %、D* 跟 Jones——
  // 每个符号当场交代了单位，等于逐个交代过口径，该算合规。
  const withUnits = [
    '## 甲', '',
    '- 响应度 $R$ 的单位是 A/W，定义为 $R=(I_{\\text{light}}-I_{\\text{dark}})/(P_{\\text{in}}A)$。',
    '- 外量子效率 $EQE=R\\cdot\\frac{1240}{\\lambda}\\times100\\%$，$\\lambda$ 取 nm。',
    '- 比探测率 $D^{\\ast}=R\\sqrt{A}/\\sqrt{2qI_{\\text{dark}}}$，单位 Jones。', '',
  ].join('\n');
  assert.equal(hits(withUnits, '符号').length, 0, '每个符号都带单位');
});

test('符号：代码常量名不算数学符号', () => {
  // 实测踩过的坑：`0002-face-px-threshold` 列出学生脚本的七个输入常量
  // （f_mm、FACE_W、PIXEL_UM…），被判成「进了六个符号」。常量写在代码里，不需要交代口径。
  const constants = '## 甲\n\n脚本的输入有 `f_mm`、`w_mm`、`D_m`、`FACE_W`、`PIXEL_UM` 五个。\n';
  assert.equal(hits(constants, '符号').length, 0);
});

test('六条判据全部仍能报警（放宽之后不许退化成一堆恒真）', () => {
  // 这条是「判据的判据」。2026-11 那几轮为了让 23 份真课件的误报归零，一共放宽了七处
  // （总表的位置、### 拆节、编号清单、图当总表、紧接一段答掉、提问可能在第二段、
  // ::: 块里的问句不算提问）。**每一次放宽都可能把判据放宽成恒真**——所以每一条都要
  // 还有一个「必然该报」的样例，否则归零就只是哑了。
  const mustReport = {
    起笔: '## 甲\n\n本节介绍视场角与焦距的关系。\n\n内容。\n',
    回收: '## 甲\n\n这个数从哪儿来？\n\n第一段。\n\n第二段。\n',
    篇幅: '## 甲\n\n' + '字'.repeat(4100) + '\n',
    并列: '## 反解焦距的三种等价写法\n\n一段铺开。\n\n又一段。\n',
    符号: '## 甲\n\n这里有 $W$、$w$、$D$、$f$ 四个量，还有 $N$ 与 $p$。\n',
    类比: '## 甲\n\n电流就像水流一样。\n\n然后讲别的。\n',
  };
  const missing = [];
  for (const [criterion, markdown] of Object.entries(mustReport)) {
    const found = inspect(markdown).filter((item) => item.判据 === criterion);
    if (found.length === 0) missing.push(criterion);
  }
  assert.deepEqual(missing, [], `这些判据已经报不出来了（放宽过头）：${missing.join('、')}`);
});

test('固定收尾（原文在哪儿 / 三句要能说出来）不进体检', () => {
  const markdown = '## 甲\n\n内容。\n\n## 原文在哪儿\n\n| 序号 | 名称 |\n| --- | --- |\n\n## 三句要能说出来\n\n- 一句话。\n';
  assert.equal(inspect(markdown).length, 0);
});
