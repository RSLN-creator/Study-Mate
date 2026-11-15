/* 端到端演练：卡 → 表 → 填 → 算 → 报分单，整条链必须走得通。
   ────────────────────────────────────────────────────────────────────────
   第二十四轮我发现了「单件全绿、串起来全错」：两个工具接口不匹配、分母口径不一致。

   这一轮把整条链真跑了一遍，又撞到三件单件测试看不见的事：

   ① **闸门落在区间内时，工具照样印「不通过」**。S1 = 0.75、区间 [0.583, 0.917]，
      0.8 就在区间里，而输出写着「→ 不通过」。**那个词会被当成判决。**
   ② **区间算法把「部分」密化了**：原来拿 S1 反推一堆合成命中，12 命中 + 3 部分
      被压成 13/18，区间失真。
   ③ **报分单没说「做的是背默卡就删掉第二节」**，于是背默卡的报告里留着一个
      「本次落在 ___ 一带」的空格，看起来像漏填。

   这条套件把这三件都钉住。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildSheet, pointsFromCard } from '../tools/recite-sheet.mjs';
import { parseTable } from '../tools/recite-from-table.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CARD = path.join(ROOT, 'templates/closed-book/背默卡.md');

/** 造一份 18 条要点、12 命中 3 部分 3 未中的判定表。 */
function filledSheet() {
  const points = Array.from({ length: 18 }, (_, i) => ({ id: `P${i + 1}`, 类型: i < 3 ? '骨架' : '因果', 要点: `要点 ${i + 1}` }));
  const sheet = buildSheet(points);
  const marks = {};
  for (let i = 1; i <= 12; i += 1) marks[`P${i}`] = 'hit';
  for (let i = 13; i <= 15; i += 1) marks[`P${i}`] = 'part';
  for (let i = 16; i <= 18; i += 1) marks[`P${i}`] = 'miss';
  return sheet.split('\n').map((line) => {
    const m = line.match(/^\| (P\d+) \| (\S+) \| (.+?) \| \[ \] \| \[ \] \| \[ \] \| \|$/);
    if (!m) return line;
    const box = { hit: '[×] | [ ] | [ ]', part: '[ ] | [×] | [ ]', miss: '[ ] | [ ] | [×]' }[marks[m[1]]];
    return `| ${m[1]} | ${m[2]} | ${m[3]} | ${box} | |`;
  }).join('\n');
}

test('端到端：生成的表填上勾，能被读回 18 条判定', () => {
  const table = parseTable(filledSheet());
  const total = table.命中.length + table.部分.length + table.未中.length;
  assert.equal(total, 18, `只读出 ${total} 条`);
  assert.equal(table.命中.length, 12);
  assert.equal(table.部分.length, 3);
  assert.equal(table.未中.length, 3);
});

test('端到端：S1 = (12 + 0.5×3) / 18 = 0.75', () => {
  const table = parseTable(filledSheet());
  const s1 = (table.命中.length + 0.5 * table.部分.length) / 18;
  assert.equal(Number(s1.toFixed(3)), 0.75);
});

test('端到端：闸门落在区间内时，命令行输出不许出现「不通过」', () => {
  // 这是端到端演练抓到的第一件事：S1 = 0.75、区间把 0.8 包在里面，工具却印「不通过」。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recite-e2e-'));
  const sheetPath = path.join(dir, '判分表.md');
  fs.writeFileSync(sheetPath, filledSheet(), 'utf8');
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/tools/recite-from-table.mjs'), sheetPath, '--s2', '2', '--probe', '1'],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });

  assert.match(out, /S1 = 0\.75/, 'S1 应当是 0.75');
  assert.match(out, /闸门 0\.8 落在区间/, '要明确说出「闸门落在区间内」');
  assert.match(out, /判不出/, '要说出「判不出」');
  assert.doesNotMatch(out, /→ 不通过/, '**闸门落在区间内时不许印「不通过」**——那个词会被当成判决');
});

test('端到端：区间要用真实判定算，不许把「部分」密化成整数条', () => {
  // 原来拿 S1 反推「13 个命中」，12 命中 + 3 部分被压成 13/18 —— 区间跟着失真。
  // 正确的区间应当比密化后的更宽（因为 3 个"半条"引入了更多抽样变动）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recite-e2e2-'));
  const sheetPath = path.join(dir, '判分表.md');
  fs.writeFileSync(sheetPath, filledSheet(), 'utf8');
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/tools/recite-from-table.mjs'), sheetPath, '--json'],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  const parsed = JSON.parse(out);
  assert.equal(parsed.S1, 0.75);
  assert.match(parsed.S1区间, /^\[0\.\d+, 0\.\d+\]$/, '区间格式要正常');
  const [lo, hi] = parsed.S1区间.slice(1, -1).split(',').map(Number);
  assert.ok(lo < 0.75 && hi > 0.75, `观测值 0.75 必须落在自己的区间 [${lo}, ${hi}] 里`);
  assert.ok(hi - lo > 0.2, `区间宽度只有 ${(hi - lo).toFixed(3)}，太窄——像是把部分分密化掉了`);
});

test('报分单说清了「做背默卡就删掉卷子那节」', () => {
  // 端到端演练时，背默卡的报分单里留着一个「本次落在 ___ 一带」的空格，
  // 看起来像漏填——其实是卷子那一节。
  const record = fs.readFileSync(path.join(ROOT, 'templates/closed-book/检验记录.md'), 'utf8');
  assert.match(record, /做的是背默卡就整节删掉/, '卷子那节要说清做背默卡时删掉');
  assert.match(record, /做的是卷子就整节删掉/, '背默卡那节要说清做卷子时删掉');
});

test('骨架背默卡生成的表是空的（不许把骨架的空行当要点）', () => {
  const points = pointsFromCard(fs.readFileSync(CARD, 'utf8').replaceAll('\r\n', '\n'));
  assert.deepEqual(points, [], '骨架里那些 `| P1 | 骨架 | |` 空行不该被当成要点');
});

test('空表不许给判定（一条都没判时，印「不通过」是假话）', () => {
  // 使用说明写好之后按原样跑命令时撞到的：生成表、**还没勾**就直接算，
  // 工具印出 `S1 = 0　95% 区间 [0, 0]` 与 `→ 不通过`。
  // 那三个数全是"什么都没填"的产物，而「不通过」会被当成判决。
  // **这和「闸门落在区间内却印不通过」是同一类：输出正确，话说错了。**
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recite-empty-'));
  const sheetPath = path.join(dir, '判分表.md');
  fs.writeFileSync(sheetPath, buildSheet(
    Array.from({ length: 18 }, (_, i) => ({ id: `P${i + 1}`, 类型: '骨架', 要点: `要点 ${i + 1}` })),
  ), 'utf8');
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath,
      [path.join(ROOT, 'scripts/tools/recite-from-table.mjs'), sheetPath, '--s2', '2', '--probe', '1'],
      { encoding: 'utf8' });
  } catch (error) {
    out = String(error.stdout || '');
    code = error.status;
  }
  fs.rmSync(dir, { recursive: true, force: true });

  assert.match(out, /一条都还没判/, '空表要明确说「一条都还没判」');
  assert.doesNotMatch(out, /→ 不通过/, '**空表不许印「不通过」**');
  assert.doesNotMatch(out, /S1 = 0　/, '空表不许印 S1 = 0——那个 0 是"没填"不是"没学会"');
  assert.notEqual(code, 0, '空表跑完应当是非零退出，提醒人还没勾');
});