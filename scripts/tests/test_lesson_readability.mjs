/* 判据分辨力校验：拿仓库自己的正负样例（lesson-design 禁写清单里的「错误/正确」对）
   喂给 analyze.mjs，看每个指标能不能把「错误句」判得比「正确句」差。

   为什么这条必须存在：可理解性指标的权重是工程约定，不是文献值。没有这条，
   「分数」只是几个数相乘，谁也不知道它到底在测什么。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyze } from '../tools/lesson-readability.mjs';
import { inspect } from '../tools/lesson-style-check.mjs';

/** 每对 = [判据, 指标键, 错误样例, 正确样例]。样例取自 lesson-design §四 禁写清单。 */
const PAIRS = [
  ['拟物动词（第 10 条）', '拟物动词次数',
    '这个递归函数吃掉了整个栈空间，程序随即崩掉。这个函数吞掉了参数。这条曲线吃掉了余量，那条曲线咬住了边缘。',
    '这个递归函数占满了整个栈空间，程序随即崩掉。'],
  ['定语嵌套（第 12 条）', '长定语连缀每千字',
    '下面给出基于深度学习的多尺度特征融合的人脸检测方法的判定标准，再看低照度的对齐损失的函数的收敛性的分析。',
    '下面给出判定标准。人脸检测用了深度学习，先做多尺度特征融合。低照度下的对齐损失好不好，看它的收敛情况。'],
];

for (const [name, key, bad, good] of PAIRS) {
  test(`${name}：错误样例必须比正确样例差`, () => {
    const a = analyze(bad);
    const b = analyze(good);
    assert.ok(a[key] > b[key], `${key}：错误 ${a[key]} 应大于正确 ${b[key]}`);
  });
}

test('连贯空缺：互不相干的短断言，比带衔接词的一段更「空」', () => {
  // 两段都要够长：一两句话的样例上百分比会抖，测不出判据。
  const bad = [
    '采样窗口按热度滑动。', '余量预算分三级。', '焦距决定视场。', '靶面决定覆盖宽度。',
    '广角端覆盖四十九米。', '长焦端只覆盖一米。', '像元二点九微米。', '机身两千五百六十像素。',
  ].join('');
  const good = [
    '采样窗口按最近的取值热度往后移，因此取值变化大的地方窗口密一些。',
    '余量预算也跟着分三级，具体来说分成本地、单机、整机这三档。',
    '焦距决定视场宽窄：焦距越长，视场越窄，因此画面里的东西越大。',
    '靶面决定覆盖宽度，也就是说同样的焦距下靶面越宽盖得越宽。',
    '广角端覆盖四十九米，所以一个人走两步也还在画面里。',
    '长焦端只覆盖一米，因此人一走动就出画。',
    '像元是二点九微米，所以这个靶面上的每个像素都这么大。',
    '机身横向两千五百六十像素，因此靶宽就是这两个数相乘。',
  ].join('');
  const a = analyze(bad);
  const b = analyze(good);
  assert.ok(a.连贯空缺率 > b.连贯空缺率,
    `连贯空缺率：错误 ${a.连贯空缺率}% 应大于正确 ${b.连贯空缺率}%`);
});

test('注入实验：把违规句插进真课件，判据必须检出（23/23）', (t) => {
  // 这条要回答一个此前没被问过的问题：**这套判据对真实材料有分辨力吗？**
  //
  // 之前的测试都拿自己造的短样例跑，那只能证明「判据写得对」，不能证明「它在真课件上
  // 工作」。做法：读一批真课件，往中间插一句必然违规的话，看指标有没有涨。
  // 这个实验抓出过一次真 bug：注入时把两句拼在一段里，拟物动词 0/23 检出——
  // 那是注入方式把句子拼坏了，不是判据坏了；改成独立成段后 23/23。
  const base = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(base, 'subjects');
  if (!fs.existsSync(subjects)) {
    t.skip('本机没有学习工作区');
    return;
  }
  const files = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'lessons');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) if (file.endsWith('.md')) files.push(path.join(dir, file));
  }
  if (files.length === 0) {
    t.skip('工作区里还没有课件');
    return;
  }
  const missed = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const before = analyze(markdown).拟物动词次数;
    const lines = markdown.split('\n');
    const headings = lines.map((line, index) => (line.startsWith('## ') ? index : -1)).filter((index) => index > 0);
    if (headings.length === 0) continue;
    const at = headings[Math.floor(headings.length / 2)];
    // **必须独立成段**：与上一句拼在同一段里会改变分句边界，注入本身就失真了。
    lines.splice(at + 2, 0, '', '这个递归函数吃掉了整个栈空间，程序随即崩掉。');
    const after = analyze(lines.join('\n')).拟物动词次数;
    if (after <= before) missed.push(path.relative(subjects, file));
  }
  assert.deepEqual(missed, [], `这些课件注入了拟物句却没检出：\n${missed.join('\n')}`);
});

test('注入实验：无断点类比也必须检出', (t) => {
  const base = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(base, 'subjects');
  if (!fs.existsSync(subjects)) {
    t.skip('本机没有学习工作区');
    return;
  }
  const files = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'lessons');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) if (file.endsWith('.md')) files.push(path.join(dir, file));
  }
  if (files.length === 0) {
    t.skip('工作区里还没有课件');
    return;
  }
  const missed = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const before = inspect(markdown).filter((item) => item.判据 === '类比').length;
    const lines = markdown.split('\n');
    const headings = lines.map((line, index) => (line.startsWith('## ') ? index : -1)).filter((index) => index > 0);
    if (headings.length === 0) continue;
    const at = headings[Math.floor(headings.length / 2)];
    lines.splice(at + 2, 0, '', '电流就像水流一样，从电源一路流向电阻，压力越大流得越快。', '', '这一段只在讲别的。');
    const after = inspect(lines.join('\n')).filter((item) => item.判据 === '类比').length;
    if (after <= before) missed.push(path.relative(subjects, file));
  }
  assert.deepEqual(missed, [], `这些课件注入了无断点类比却没检出：\n${missed.join('\n')}`);
});

test('前端块（代码、图、frontmatter）不进统计', () => {
  const withBlock = '---\ntitle: 测试\n---\n\n正文一句话在这里说明一件具体的事。\n\n```python\n# 这个函数吃掉了栈\nx = 1\n```\n';
  const plain = '正文一句话在这里说明一件具体的事。\n';
  assert.equal(analyze(withBlock).汉字数, analyze(plain).汉字数);
});

test('表行与图块字段（alt/caption）不进统计', () => {
  const withTable = '正文一句话在这里说明一件具体的事。\n\n| 对比项 | A 机 | B 机 |\n| --- | --- | --- |\n| 焦距 | 未公开 | 8–32 mm |\n\nalt: 一张很长的图注说明\ncaption: 另一句很长的说明\n';
  const plain = '正文一句话在这里说明一件具体的事。\n';
  assert.equal(analyze(withTable).汉字数, analyze(plain).汉字数);
});
