/* 从要点表生成空白判分表：画表这一步没有判断成分，纯粹体力活——体力活正是让人放弃的地方。
   ────────────────────────────────────────────────────────────────────────
   判 18 条要点时，判分者手上应该已经有一张表，而不是自己从头画。
   这条套件钉住：生成的行数与要点数一致、每行三个勾选框都在、以及**生成的表能被
   `recite-from-table` 读回去**（两个工具必须接得上——第一版接不上，填好的表喂进去一条都解析不出）。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSheet, pointsFromCard } from '../tools/recite-sheet.mjs';
import { parseTable } from '../tools/recite-from-table.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const card = () => fs.readFileSync(
  path.join(ROOT, 'templates/closed-book/背默卡.md'), 'utf8',
).replaceAll('\r\n', '\n');

test('骨架背默卡里那节要点表是空的（骨架不该预填）', () => {
  assert.deepEqual(pointsFromCard(card()), []);
});

test('能从一个真背默卡里抠出要点表', (t) => {
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }
  const cards = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('-背默卡.md')) cards.push(path.join(dir, file));
    }
  }
  if (cards.length === 0) { t.skip('工作区里还没有背默卡'); return; }
  for (const file of cards) {
    const points = pointsFromCard(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
    assert.ok(points.length >= 15, `${path.basename(file)} 只抠出 ${points.length} 条要点`);
    assert.ok(points.every((p) => p.id && p.类型 && p.要点), '每条都要有编号、类型、正文');
  }
});

test('生成的表：行数与要点数一致，每行三个勾选框', () => {
  const points = [
    { id: 'P1', 类型: '骨架', 要点: '甲' },
    { id: 'P2', 类型: '因果', 要点: '乙' },
  ];
  const sheet = buildSheet(points);
  const rows = sheet.split('\n').filter((line) => /^\|\s*P\d+\s*\|/.test(line));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal((row.match(/\[ \]/g) || []).length, 3, `「${row.slice(0, 20)}」的勾选框不是三个`);
  }
  assert.match(sheet, /S2 结构档/, '整体判断两栏要在');
  assert.match(sheet, /迁移探针/, '探针要在');
  assert.match(sheet, /不许空着/, '「判得最没把握的一条」要提醒不许空着');
});

test('两个工具必须接得上：生成的表填上勾之后能读回去', () => {
  // 第一版接不上——`recite-sheet` 生成的是勾选框表，而 `recite-from-table` 只读第 2 格。
  const sheet = buildSheet([{ id: 'P1', 类型: '骨架', 要点: '甲' }, { id: 'P2', 类型: '因果', 要点: '乙' }]);
  const filled = sheet
    .replace('| [ ] | [ ] | [ ] |', '| [×] | [ ] | [ ] |')
    .replace(/\[\s*\]\s*\|\s*\[\s*\]\s*\|\s*\[\s*\]\s*\|/, '| [ ] | [×] | [ ] |');
  const table = parseTable(filled);
  assert.equal(table.命中.length + table.部分.length + table.未中.length, 2,
    '填好的表喂给 recite-from-table 必须能解析出判定');
  assert.equal(table.命中.length, 1);
  assert.equal(table.部分.length, 1);
});
