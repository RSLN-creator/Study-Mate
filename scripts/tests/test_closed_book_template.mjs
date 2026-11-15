/* 闭卷卷子与判分键的骨架守卫。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：`templates/closed-book/` 的两份骨架是「出题角色照抄」的东西，抄错一处
   就产出一份不可比的量具。而这份量具的三条硬规矩（两份分开、同时写、只看产物判）全在文字里，
   没有任何自动检查会红——除非这里钉住。

   钉的是**结构**，不是措辞：五个部分的名字与配分、两条判定线、三条局限、以及「不许打开」的
   那条警告。措辞可以改，这些东西改了就等于换了一把尺子。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(ROOT, 'templates', 'closed-book');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replaceAll('\r\n', '\n');

test('两份骨架都在，且判分键的名字里带「判分键」', () => {
  const entries = fs.readdirSync(DIR).sort();
  assert.ok(entries.includes('卷子.md'), '卷子骨架要在');
  assert.ok(entries.includes('判分键.md'), '判分键骨架要在——名字里必须带「判分键」，那是在说"别先打开我"');
  assert.ok(entries.includes('README.md'), '两份骨架的用法说明要在');
});

test('判分键开头有「评卷前不要打开」与「收到答卷之后才打开」两句', () => {
  const key = read('判分键.md');
  assert.match(key, /在评卷前不要打开/, '判分键必须自带那句警告');
  assert.match(key, /收到答卷之后才打开/, '评分记录要写明这一点，骨架得先把它说出来');
});

test('五个部分的名字与配分逐字一致（配分是量具的一部分，改了就不可比）', () => {
  const expected = [
    ['一、骨架（20 分）', 20],
    ['二、因果（35 分）', 35],
    ['三、数值（20 分）', 20],
    ['四、迁移（15 分）', 15],
    ['五、元认知（10 分）', 10],
  ];
  for (const name of ['卷子.md', '判分键.md']) {
    const text = read(name);
    let sum = 0;
    for (const [heading, points] of expected) {
      assert.ok(text.includes(`## ${heading}`), `${name} 缺「## ${heading}」`);
      sum += points;
    }
    assert.equal(sum, 100, '五部分配分要凑满 100');
  }
});

test('判定带之间的距离与半宽对得上，或者判分键明说「单次施测分辨不出」', async () => {
  // 这一条是**算出来的**，不是抄的。第一版判分键写「半宽约 ±8 分」、线与线隔 15 分——
  // 实算半宽 6–19 分，两条线落在同一个半宽里，一次施测根本分不开。
  //
  // 判据有两条出路，**必须走其中一条**：
  //   ① 带与带之间隔开 2×半宽（带子不重叠）；
  //   ② 隔不开时，判分键必须**明说**「单次施测分辨不出三条带」，并给出改用的读法
  //      （同一份卷子隔一段时间重做、看是否落在同一带；剖面比总分稳）。
  // 2026-11-15 这一版走的是②：总分只有 100、20 个计分点的半宽 6–19 分，
  // 要把三条带分到不重叠需要隔 30 分以上，做不到。硬撑成"能分辨"才是真的错。
  const { bootstrapTotal, pointsOf } = await import('../tools/closed-book-bootstrap.mjs');
  const widest = Math.max(...[
    { full: 14, half: 4, zero: 2 },
    { full: 10, half: 5, zero: 5 },
    { full: 6, half: 4, zero: 10 },
  ].map((spec) => bootstrapTotal(pointsOf(spec)).半宽));
  assert.ok(widest >= 13, `20 个计分点的半宽实算是 ${widest}，不该小于 13`);

  const key = read('判分键.md');
  // 判分键那里的分数带 Markdown 粗体（`总分 **≥ 90**`），所以不按符号解析，
  // 只取「判定线」那一块里出现的全部两位数，去重排序，相邻两个就是两条带的边界。
  const block = key.slice(key.indexOf('**判定线**'), key.indexOf('**为什么'));
  assert.ok(block.length > 40, '判分键里要有一块「判定线」');
  const thresholds = [...new Set([...block.matchAll(/(\d{2})(?=\s*[%分\*，。）]|\s*–)/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 30 && n <= 100)
    .sort((a, b) => a - b);
  assert.ok(thresholds.length >= 2, `判定线那一块里要认出至少两个阈值，实际认出 ${JSON.stringify(thresholds)}`);
  const gap = thresholds[1] - thresholds[0];
  assert.ok(gap > 2 * widest || /单次施测分辨不出/.test(key),
    `两条判定带相距 ${gap} 分（阈值 ${JSON.stringify(thresholds)}），而半宽是 ${widest}：` +
    '要么把带子隔开 2×半宽，要么在判分键里明说「单次施测分辨不出」并给出改用的读法');
  assert.match(key, new RegExp(`半宽 ${Math.floor(widest)}–${Math.ceil(widest)} 分|半宽 6–19 分`),
    '判分键里写出来的半宽要与脚本算出来的量级一致');
});

test('三条局限都在：一次性施测、实算半宽、可能漏掉有价值的部分', () => {
  const key = read('判分键.md');
  assert.match(key, /一次性施测/, '分不出「这次没想起来」与「本来就没学会」');
  assert.doesNotMatch(key, /±8 分/, '±8 分是拍出来的数，实算是 6–19 分，不许再写回去');
  assert.match(key, /6–19 分/, '半宽要写实测值');
  assert.match(key, /可能漏掉/, '卷子按课件出，可能漏掉课里有价值但没出题的部分');
});

test('计分总则里写了「只看产物、不看自评」与「±2% 算命中」', () => {
  const key = read('判分键.md');
  assert.match(key, /只看写出来的内容判/, '这是 2026-11-15 两个评分者分岔的那一条，必须写死');
  assert.match(key, /不看答题者什么时候记住的/);
  assert.match(key, /±2%/, '数值容差要写死，否则不同批次不可比');
});


test('README 写清三条硬规矩与「模型不代答」', () => {
  const readme = read('README.md');
  assert.match(readme, /两份必须分开/, '第一条硬规矩');
  assert.match(readme, /两份必须同时写/, '第二条硬规矩');
  assert.match(readme, /只看写出来的内容判/, '第三条硬规矩');
  assert.match(readme, /模型不代答/, '被试必须是人——这条没有例外');
});

test('节拍表在卷子里，且明说「不是复习排期」', () => {
  // 检索练习那一方向的落地只有一处：卷子里这三个时点。它们必须同时满足两件事——
  //   · 时点与证据对得上（+1 天是硬的，Cepeda 2006/2008；+7/+30 是外推）；
  //   · 明说「不是复习排期」——仓库把「间隔重复、复习队列、任何待复习汇总」列在非目标里。
  // 判据同时盯这两头：缺时点 = 那一方向没落地；缺「不是排期」那句 = 越界。
  const paper = read('卷子.md');
  assert.match(paper, /\+1 天/, '最短那个时点是最硬的一条证据，不能省');
  assert.match(paper, /\+7 天/);
  assert.match(paper, /\+30 天/);
  assert.match(paper, /答对了也别停/, '「答对就出队」是最容易犯的错（Karpicke & Roediger 2008：35% vs 80%）');
  assert.match(paper, /别在同一天连做几遍/, '同一天集中重复 ≈ 没重复');
  assert.match(paper, /不是复习排期/, '必须与「不做复习队列」那条非目标划清');
  assert.match(paper, /系统里没有"到期"记录|系统里没有「到期」记录|没有"到期"记录/,
    '要说清系统不做排期器——否则读的人会以为有东西在跟踪');
  assert.match(paper, /目标态规格/, '越界与否的判据挂在哪份文档上，要写出来');
});
test('判分键里不许「一格两事」：每个得分点只判一件事', () => {
  // 2026-11-15 的判可评性实测（第八轮）暴露的头号缺陷：一个得分格里塞了两件事，
  // 三个人各按自己的读法判，每题抖 1.5 分；而判定带只有 22 分隔、半宽却有 15 分，
  // **几次抖动叠加就足以跨带**（实测：同一份答卷，一人判「通过」，两人判「部分通过」）。
  //
  // 判据：所有「(a) N 分」「(b) N 分」这类小问格里，**不许同时出现两个"要"**——
  // 具体抓两种写法：① 「X。Y。」两句都是得分要求却共用一格；② 括注里写「任答两种，每种…」
  // 却把「必须先排掉」夹在同一条目内。
  //
  // 这条撤不掉：它守的是「分数可比」这个前提。判分键一格两事，量具就不可比。
  const key = read('判分键.md');
  // 骨架允许用「各 1.5 分」「各 1 分」这类**显式拆分**——那种写法把两件事分开了，不算违规。
  const explicitSplit = /各\s*[\d.]+\s*分|分别\s*[\d.]+\s*分|\+\s*[\d.]+\s*分|[\d.]+\s*分\s*\+\s*[^。]{0,24}[\d.]+\s*分|两个得分点|三个得分点|两半各算各的/;
  const offenders = [];
  for (const match of key.matchAll(/^- \(([a-d])\)\s*(?:（)?([\d.]+)\s*分([^\n]*)\n((?:  .*\n)*)/gm)) {
    const body = match[0];
    if (explicitSplit.test(body)) continue;
    // 一个格子里出现两个「分」= 两个得分点，且没显式拆
    const scoreMarks = [...body.matchAll(/[\d.]+\s*分/g)].length;
    if (scoreMarks >= 2) offenders.push(body.split('\n')[0].trim().slice(0, 60));
  }
  assert.deepEqual(offenders, [],
    '这些得分格里出现了两个配分却没写「各 N 分」——一格两事会让评分者各判各的：\n' + offenders.join('\n'));

  // **反证**：这一条必须真报得出来。构造一个「一格两事」的判分键，判据要抓到它。
  // 没有这段反证，「不许一格两事」就只是一句永远通过的声明。
  const broken = [
    '## 二、因果（9 分）',
    '',
    '**4.**（9 分）',
    '- (a) 3 分：<得分点一>。3 分：<得分点二>，只写前一半给 1.5 分。',
    '',
  ].join('\n');
  const caught = [];
  for (const match of broken.matchAll(/^- \(([a-d])\)\s*(?:（)?([\d.]+)\s*分([^\n]*)\n((?:  .*\n)*)/gm)) {
    const body = match[0];
    if (explicitSplit.test(body)) continue;
    if ([...body.matchAll(/[\d.]+\s*分/g)].length >= 2) caught.push(body.trim().slice(0, 40));
  }
  assert.equal(caught.length, 1, '故意写的一格两事必须被这条判据抓到');
});

test('锚点数据集在手，且写清它自己的局限与「对照实验没能证明它有用」', () => {
  // 2026-11-15：三份卷子、六份判分键之后，还缺一样东西——**评分不许各凭直觉**。
  // 锚点数据集收的是「已知分数的作答片段」，评分者拿不准时对照它。
  //
  // 但它自己必须诚实：**这份数据集有没有用，还没测过**（给锚点 vs 不给，一致性差多少）。
  // 在那之前它的定位是"记录"，不是"量具"——文件里必须有这句话，否则读的人会以为它已被验证。
  const dataset = read('判分锚点数据集.md');
  assert.match(dataset, /三个独立评分者的实测|三人一致/, '锚点必须标出它来自哪次实测');
  assert.match(dataset, /不是给学生用的|给评分者用的/, '要写清这份文件的读者是谁');
  assert.match(dataset, /锚点与判分键冲突时，以判分键为准/, '锚点是例证，不是判分键的替代品');
  assert.match(dataset, /天花板效应|什么也证明不了/, '对照实验做过了但没能证明——这个结论必须写进去');
  assert.match(dataset, /记录，不是量具/, '它的定位必须说清：记录不是量具');
  assert.match(dataset, /只有一份答卷/, '要写清数据量的极限');
  // 骨架里不许留编造的样例：每条锚点都要有「作答原文」或「三人一致」这类可核对的字样
  assert.match(dataset, /作答原文/, '每条锚点要带作答原文，否则无法核对');
});
test('lab 骨架没被这一份影响（两套骨架互不污染）', () => {
  const lab = path.join(ROOT, 'templates', 'lab');
  assert.ok(fs.existsSync(path.join(lab, '0000-示例', 'check.sh')), 'lab 骨架的判分入口还在');
  assert.ok(!fs.existsSync(path.join(DIR, 'check.sh')), '闭卷骨架不该有判分入口——它不是 lab');
});