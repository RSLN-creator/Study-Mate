/* 从手写判定表直接算 S1：中间这一步最容易让人放弃。
   ────────────────────────────────────────────────────────────────────────
   `recite-score.mjs` 要的是 JSON。可判分者手上是一张表：
       P1 命中
       P6 部分
   中间转一手编 JSON，是"填检验记录"最容易放弃的地方——判完已经很累。

   `recite-from-table.mjs` 就是这一步。**但它自己踩了三个坑，全在写的时候一次犯完**：

   ① 把 `|` 开头的行当成"跳过"，于是 `| P1 | 命中 |` 表格行全丢；
   ② 只按 `|` 与制表符切，最常见的 `P1 命中`（空格分隔）被丢——**8 行表只解析出 1 条**；
   ③ `const file = args.find(a => !a.startsWith('--'))`：`--s2 2` 里的 `2` 也被当成文件名，
      于是它去读一个叫 "2" 的文件，读不到就静默退化成 1 条判定。

   三个坑合起来的效果是：**工具不报错，只是算出的 S1 完全是错的。**
   这就是为什么要有这条套件。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { missingVerdicts, parseLine, parseTable } from '../tools/recite-from-table.mjs';

test('三种写法都要认：空格分隔、制表符、表格行', () => {
  for (const line of ['P1 命中', 'P1\t命中', '| P1 | 命中 | 理由 |']) {
    const parsed = parseLine(line);
    assert.ok(parsed, `「${line}」没被认出来`);
    assert.equal(parsed.id, 'P1');
    assert.equal(parsed.值, 1);
  }
});

test('判定词的同义写法都认，且值对得上', () => {
  const cases = [
    ['P1 命中', 1], ['P1 中', 1], ['P1 hit', 1], ['P1 1', 1],
    ['P2 部分', 0.5], ['P2 半', 0.5], ['P2 partial', 0.5], ['P2 0.5', 0.5],
    ['P3 未中', 0], ['P3 没', 0], ['P3 miss', 0], ['P3 0', 0],
  ];
  for (const [line, expected] of cases) {
    const parsed = parseLine(line);
    assert.ok(parsed, `「${line}」没被认出来`);
    assert.equal(parsed.值, expected, `「${line}」的值应当是 ${expected}`);
  }
});

test('反证：一份 8 行的混合写法表，必须解析出 8 条', () => {
  // 第一版在这份表上只解析出 1 条（只有表格行那条活下来）。
  const text = [
    'P1 命中', 'P2 部分', 'P3 命中', 'P4 未中',
    'P5 命中', '| P6 | 部分 | 只写了关键词 |', 'P7 hit', 'P8 miss',
  ].join('\n');
  const table = parseTable(text);
  const total = table.命中.length + table.部分.length + table.未中.length;
  assert.equal(total, 8, `8 行的表只解析出 ${total} 条`);
  assert.equal(table.命中.length, 4);
  assert.equal(table.部分.length, 2);
  assert.equal(table.未中.length, 2);
});

test('同一要点判两次只算一次（不重复计入）', () => {
  const table = parseTable('P1 命中\nP1 部分\nP2 未中');
  assert.equal(table.命中.length + table.部分.length + table.未中.length, 2, '重复的 P1 被算了两次');
});

test('要点表里有、判定表里没有的 → 记「未判」，不许当「未中」', () => {
  // 这是最容易出错的一步：把"没判"算成"未中"，S1 会凭空变低，而且看不出来。
  const rubric = { 要点: [{ id: 'P1' }, { id: 'P2' }, { id: 'P3' }] };
  const table = parseTable('P1 命中\nP2 未中');
  assert.deepEqual(missingVerdicts(rubric, table), ['P3']);
});

test('表头、注释、无关行不许被当成判定', () => {
  const text = [
    '# 判分表',
    '| 题号 | 判定 | 理由 |',
    '| --- | --- | --- |',
    'P1 命中',
    '',
    '这一行是说明文字，不该被解析。',
  ].join('\n');
  const table = parseTable(text);
  assert.equal(table.命中.length, 1);
  assert.equal(table.部分.length + table.未中.length, 0);
});
