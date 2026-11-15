#!/usr/bin/env node
/* 学习方法层的总检查：一条命令跑完所有「这份产物干不干净」的事。
 *
 * 为什么要有它：前二十九轮攒了 10 个工具，散在 `package.json` 里。人要做一次检验，
 * 得记住 6 个命令、还得知道哪个先哪个后。**记不住就不会跑；不会跑，判据就等于不存在。**
 *
 * 它**不判分**——判分要人看产物。它只查"这份产物有没有低级问题"：
 *   ① 卷子与判分键成对、无占位符、配分算术自洽；
 *   ② 背默卡要点表够数、三类齐、数字能在课件里找到；
 *   ③ 题目问的材料课件里有；
 *   ④ 判分键与卷子的共用段落和骨架一致；
 *   ⑤ 判分键与要点表没出现在阅读端可读的目录里。
 *
 * 用法：
 *   node study-method-check.mjs            # 全部跑一遍
 *   node study-method-check.mjs --quiet    # 只报问题
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const quiet = process.argv.includes('--quiet');

/** 一项检查：名字 + 用哪个测试文件跑 + 它查什么。 */
const CHECKS = [
  ['卷子与判分键成对、无占位符', 'scripts/tests/test_closed_book_scoring.mjs', '同一科目下每份卷子都有配对的判分键，且卷里没留 `<…>`'],
  ['配分算术自洽', 'scripts/tests/test_closed_book_scoring.mjs', '小问加起来等于大题满分，五部分凑满 100'],
  ['背默卡要点表可用', 'scripts/tests/test_recite_card.mjs', '≥15 条、三类齐、数字能在课件里找到、写明覆盖哪几节'],
  ['题目问的材料课件里有', 'scripts/tests/test_question_answerable.mjs', '每道题的数字与术语都能追溯到课件'],
  ['判分键共用段落与骨架一致', 'scripts/tests/test_key_common_sync.mjs', '背默卡计分那一节逐字相同；卷子的节拍表逐字相同'],
  ['答案没进可读目录', 'scripts/tests/test_no_answer_leak.mjs', '判分键与背默卡不在 `reference/` 或 `lessons/` 里'],
];

function run(file) {
  try {
    execFileSync(process.execPath, ['--test', path.join(ROOT, file)], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const workspace = process.env.LEARN_WORKSPACE
  || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
if (!fs.existsSync(path.join(workspace, 'subjects'))) {
  console.error(`没有学习工作区：${workspace}`);
  console.error('设 LEARN_WORKSPACE 指到 .learning 目录再跑。');
  process.exit(2);
}

if (!quiet) {
  console.log(`工作区：${workspace}`);
  console.log('—— 学习方法层总检查 ——\n');
}

let failed = 0;
const seen = new Set();
for (const [name, file, what] of CHECKS) {
  // 同一个文件跑两次没意义（前两条都用 `test_closed_book_scoring`）
  if (seen.has(file)) continue;
  seen.add(file);
  const result = run(file);
  if (!result.ok) failed += 1;
  if (!quiet) console.log(`${result.ok ? '✔' : '✖'} ${name}`);
  if (!quiet) console.log(`   ${what}`);
  if (!result.ok) {
    // 只印失败套件里的断言信息，不印整段 node --test 输出
    const lines = result.out.split('\n').filter((l) => /AssertionError|：|·/.test(l)).slice(0, 8);
    for (const line of lines) console.log(`   ${line.trim()}`);
  }
}

if (!quiet) console.log('');
if (failed === 0) {
  console.log('全部通过。产物干净——接下来要人做的事：读、合上原文、手写、判分。');
} else {
  console.log(`${failed} 项没通过。`);
  process.exitCode = 1;
}
