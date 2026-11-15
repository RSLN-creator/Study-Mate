/* 题目可答性：卷子上的题问的东西，课件里有没有？
   ────────────────────────────────────────────────────────────────────────
   为什么要有它：如果一道题问的数字或概念课件里根本没有，**学生答不出来不是他的问题，
   是出题的问题**。而这种题最坑——它看起来完全正常，学生只会以为自己没读懂。

   这个工具写的时候犯了一串误报，每一类都值得记住——**误报一多，判据就没人看了**：
   ① `4.2` 命中课件里的 `74.2`（子串匹配）；
   ② 迁移题故意换的新参数（`1920 像素`）被报成"课件里没有"——**那正是它的设计**；
   ③ 题面自己给的常数（`换算因子取 1240`）被报成缺材料；
   ④ 粗体里的**指令**（`任意两种`、`逐节打分`）被当成术语；
   ⑤ 粗体里的题号（`7.` `12.`）被当成术语；
   ⑥ 术语差一个字（`感光面横向宽度` vs 课件里的 `感光面宽`）被报成缺失。

   这条套件逐条钉住这六类。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkQuestion, extractQuestions } from '../tools/question-answerable.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const lesson = '严格式与近似式差一个靶宽。两式之差正好是 w 本身，7.424 mm。感光面宽 7.424 mm。';

test('能从卷子里切出每道题（多行题干）', () => {
  const paper = [
    '## 一、骨架（20 分）',
    '',
    '**1.**（6 分）第一题',
    '跨了两行',
    '',
    '**2.**（8 分）第二题',
    '',
  ].join('\n');
  const questions = extractQuestions(paper);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].number, 1);
  assert.match(questions[0].text, /跨了两行/, '多行题干要一起切进来');
});

test('① 数字按完整边界匹配：`4.2` 不许命中 `74.2`', () => {
  const q = { number: 1, text: '**1.** 求 4.20 的值' };
  const result = checkQuestion(q, '课件里写着 74.2 mm 与 4.21°');
  assert.ok(result.problems.some((p) => p.includes('4.20')), '4.20 不该在 74.2 / 4.21 里被当成命中');
});

test('② 迁移题的「假设换一台机器」不许报缺材料', () => {
  // 这是最重要的一条：迁移题的参数**本来就不该在课件里**，那正是它在测的东西。
  const q = { number: 10, text: '**10.** 假设换一台机器：横向 1920 像素、像元 1.45 µm。求靶宽。' };
  const result = checkQuestion(q, lesson);
  assert.deepEqual(result.problems, [], '迁移题的新参数不该被报成缺材料——那正是它的设计');
});

test('③ 题面自己给的常数不算缺材料', () => {
  const q = { number: 9, text: '**9.** 把 2.84 A/W 换成外量子效率，换算因子取 1240，算式？' };
  const result = checkQuestion(q, lesson);
  assert.ok(!result.problems.some((p) => p.includes('1240')), '题面给了 1240，不该报缺');
});

test('④ 粗体里的指令不算术语', () => {
  const q = { number: 7, text: '**7.** 写出其中**任意两种**，并**说明**各自的解释力' };
  const result = checkQuestion(q, lesson);
  assert.deepEqual(result.problems, [], '指令（任意两种 / 说明）不是术语');
});

test('⑤ 粗体里的题号不算术语', () => {
  const q = { number: 12, text: '**12.** 逐节打分（见 **7.** 与 **12.** 两处）' };
  const result = checkQuestion(q, lesson);
  assert.deepEqual(result.problems, [], '题号不是术语');
});

test('⑥ 术语差一个字不算缺失（感光面横向宽度 vs 感光面宽）', () => {
  const q = { number: 1, text: '**1.** 这台机器的**感光面横向宽度**是多少？' };
  const result = checkQuestion(q, lesson);
  assert.deepEqual(result.problems, [], '差一个修饰词不该报——学生一眼能对上');
});

test('真问题必须报出来：题目用了课件里根本没有的词', () => {
  const q = { number: 1, text: '**1.** 这台机器的**量子效率峰值**是多少？' };
  const result = checkQuestion(q, lesson);
  assert.ok(result.problems.length > 0, '课件里没有「量子效率峰值」，这道题问不出来');
});

test('对三份真卷子跑一遍：剩下的报警都是可解释的', (t) => {
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }
  let pairs = 0;
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('-卷子.md')) continue;
      const lessonFile = path.join(subjects, subject.name, 'lessons', file.replace(/-卷子\.md$/, '.md'));
      if (!fs.existsSync(lessonFile)) continue;
      pairs += 1;
      const text = fs.readFileSync(lessonFile, 'utf8');
      const flagged = extractQuestions(fs.readFileSync(path.join(dir, file), 'utf8'))
        .map((q) => checkQuestion(q, text)).filter((r) => r.problems.length);
      // 不要求零报警——这个工具是弱信号（只查"材料在不在"，不查"能不能推出来"）。
      // 要求的是：报警不能多到淹掉真问题。
      assert.ok(flagged.length <= 6, `${file} 有 ${flagged.length} 处报警，太多会被忽略`);
    }
  }
  if (pairs === 0) t.skip('工作区里还没有卷子');
});
