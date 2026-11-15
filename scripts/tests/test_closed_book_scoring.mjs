/* 闭卷卷子的配分算术必须自洽。
   ────────────────────────────────────────────────────────────────────────
   为什么值得单有一条：卷子的配分是**量具的一部分**——配分错一分，两次的分数就不可比。
   而配分错误不靠眼睛看得出来：小问加起来比大题多、或少一分，卷面看上去完全正常。

   这条套件做两件事：
   ① 骨架（`templates/closed-book/`）的五部分配分凑满 100；
   ② **每一份额外的真卷子**（如果工作区里放了）里，二/四部分的小问配分之和等于该题满分。

   它自己会跳过没有真卷子的情况——真卷子放在学生的**工作区**里，那不在仓库里，
   CI 上没有。所以这条套件的重心是「算式写得对」，而不是「某份卷子对」。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const key = fs.readFileSync(path.join(ROOT, 'templates', 'closed-book', '判分键.md'), 'utf8')
  .replaceAll('\r\n', '\n');

/** 从判分键正文里读出「第 N 题 满分 X，小问 a/b/c 各 Y 分」这张账。
 *
 * 两种配分写法都要认：
 *   · **逐小问写分**：`- (a) 3 分：…`，小问之和要等于该题满分；
 *   · **按空计分**：`每空 2 分`（数值部分的表格式），这类题的满分由空数 × 每空分决定，
 *     小问求和那套对它不适用——不认第二种会让每一份数值题都被误报。
 */
export function auditScoring(text) {
  const problems = [];
  const sections = text.split(/^## /m).slice(1);
  for (const section of sections) {
    const heading = section.split('\n')[0].trim();
    const total = /（(\d+) 分）/.exec(heading);
    if (!total) continue;
    const questions = [...section.matchAll(/^\*\*(\d+)\.\*\*（([^）]+)）/mg)];
    let questionSum = 0;
    let perCellSeen = false;
    for (const match of questions) {
      const number = Number(match[1]);
      const spec = match[2];
      const perQuestion = Number((/(\d+) 分/.exec(spec) || [])[1]);
      if (!Number.isFinite(perQuestion)) continue;      // 骨架里的 `<分>` 占位符，跳过
      questionSum += perQuestion;
      const start = match.index + match[0].length;
      const next = section.indexOf('\n**' + (number + 1) + '.**', start);
      const body = section.slice(start, next < 0 ? section.length : next);
      if (/每(?:个)?空 \d+ 分/.test(body) || /每(?:个)?空 \d+ 分/.test(spec)) {
        perCellSeen = true;                              // 按空计分的题，不参与小问求和
        continue;
      }
      const subs = [...body.matchAll(/\(([a-d])\)\s*(?:（)?(\d+) 分/g)].map((m) => Number(m[2]));
      if (subs.length === 0) continue;
      const subSum = subs.reduce((a, b) => a + b, 0);
      if (subSum !== perQuestion) {
        problems.push(`「${heading}」第 ${number} 题：满分 ${perQuestion}，小问合计 ${subSum}`);
      }
    }
    // 有大题合计对不上的，只在该部分里**没有**按空计分的题时才报——
    // 按空计分那一部分（数值题）的满分是空数 × 每空分，不由 `**N.**（X 分）` 加出来。
    if (questionSum > 0 && !perCellSeen && questionSum !== Number(total[1])) {
      problems.push(`「${heading}」：大题合计 ${questionSum}，部分满分 ${total[1]}`);
    }
  }
  return problems;
}

test('骨架的五部分配分自洽（小问加起来等于大题）', () => {
  const problems = auditScoring(key);
  assert.deepEqual(problems, [], `骨架判分键的配分对不上：\n${problems.join('\n')}`);
});

test('配分审计自己不空转：故意写错一处，必须报出来', () => {
  // 这一条是「判据的判据」——不写它，auditScoring 哪天退化成恒真也照样绿。
  const broken = [
    '## 二、因果（9 分）',
    '',
    '**4.**（9 分）',
    '- (a) 3 分：<答案>。',
    '- (b) 2 分：<答案>。',   // 3+2+3 = 8，不是 9
    '- (c) 3 分：<答案>。',
    '',
  ].join('\n');
  const problems = auditScoring(broken);
  assert.equal(problems.length, 1, `应当报出 1 处，实际 ${JSON.stringify(problems)}`);
  assert.match(problems[0], /满分 9，小问合计 8/);

  const good = broken.replace('(b) 2 分', '(b) 3 分');
  assert.deepEqual(auditScoring(good), [], '改对之后不该再报');
});

test('配分审计认「每空 N 分」这种写法（不认它会把每份数值题都误报）', () => {
  // 实测踩过的坑：第一版只认逐小问的 `(a) N 分`，于是两份真卷子的「三、数值」
  // 全被判成「大题合计 4，部分满分 20」——数值部分是表格式、按空计分，根本不该走上
  // 小问求和那条路。判据要么认它，要么把每一份数值题都当成错的。
  const byCell = [
    '## 三、数值（20 分）',
    '',
    '**8.**（每空 2 分，共 16 分）',
    '',
    '| 指标 | A | B | C | D |',
    '| --- | --- | --- | --- | --- |',
    '| x | 1 | 2 | 3 | 4 |',
    '',
    '**9.**（4 分）',
    '- 算式：`a = b`（2 分）。',
    '- 数值：`c`（2 分）。',
    '',
  ].join('\n');
  assert.deepEqual(auditScoring(byCell), [], '按空计分的部分不该被小问求和误报');
});

test('工作区里如果有真卷子，也一起审（没有就跳过）', (t) => {
  // 真卷子在学生的工作区，不在仓库里。CI 上必然没有——那就跳过，不当成失败。
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  if (!fs.existsSync(workspace)) {
    t.skip('本机没有学习工作区');
    return;
  }
  const found = [];
  for (const subject of fs.readdirSync(path.join(workspace, 'subjects'), { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(workspace, 'subjects', subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.includes('判分键')) continue;
      found.push([subject.name + '/' + file, path.join(dir, file)]);
    }
  }
  if (found.length === 0) {
    t.skip('工作区里还没有判分键');
    return;
  }
  const problems = [];
  for (const [name, file] of found) {
    for (const problem of auditScoring(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))) {
      problems.push(`${name} → ${problem}`);
    }
  }
  assert.deepEqual(problems, [], `工作区里的判分键配分对不上：\n${problems.join('\n')}`);
});
