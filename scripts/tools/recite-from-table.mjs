#!/usr/bin/env node
/* 从「判分者手写的逐条判定」直接算 S1 与区间，不用先编 JSON。
 *
 * 为什么要有它：讲解/出卷角色判完背默卡，手上是一张这样的表——
 *     P1 命中
 *     P3 部分
 *     P4 未中
 * 而 `recite-score.mjs` 要的是 JSON（`{"命中":["P1"],"部分":["P3"]}`）。
 * **中间这一步转手，是"填报分单"最容易放弃的地方**：判完已经很累，还要编 JSON。
 * 这个工具直接吃那张表。
 *
 * 用法一（推荐）：给一个 markdown 文件，里面是逐条判定行
 *   node recite-from-table.mjs <判分表.md> [--rubric <要点表.json>] [--json]
 *   `--rubric` 给了就一并算出「缺口」清单（哪些要点没中）。
 *   不给也行——S1 与区间只依赖判定本身。
 *
 * 用法二：从 stdin 读，一行一条
 *   echo "P1 命中" | node recite-from-table.mjs -
 *
 * 判定词认这些（大小写、简繁不敏感）：
 *   命中 / 中 / hit / 1  → 1
 *   部分 / partial / 0.5 → 0.5
 *   未中 / 没 / miss / 0 → 0
 *
 * 结构档与迁移探针不在这份表里（它们是整体判断），用 `--s2` `--probe` 传：
 *   node recite-from-table.mjs 判分表.md --s2 2 --probe 1
 */
import fs from 'node:fs';

import { bootstrapS1, scoreRecite } from './recite-score.mjs';

const CORE = [
  [/^(命中|中|对|hit|h|1)$/i, 1, '命中'],
  [/^(部分|半|部分命中|partial|p|0\.5|½)$/i, 0.5, '部分'],
  [/^(未中|没|错|空|未|miss|m|0)$/i, 0, '未中'],
];

/** 一行判定 → { id, 档, 值 }，认不出就返回 null。 */
export function parseLine(line) {
  const raw = line.replaceAll('\r', '').trim();
  if (!raw || raw.startsWith('#')) return null;
  // `| P1 | 命中 | 理由 |` 这类表格行也认（剥掉竖线再解析）。
  // **第一版写错过**：把 `startsWith('|')` 也当成"跳过"，于是表格行全被丢掉，
  // 一份 8 行的判定表只解析出 1 条。
  // 三种写法都要认：P1 命中（空格分隔）、P1\t命中（制表符）、`| P1 | 命中 |`（表格）。
  // **第一版只按 | 与制表符切**，于是最常见的 `P1 命中` 被丢掉了——8 行表只解析出 1 条。
  const cells = raw.split(/[|\t]+/).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) {
    // 也认空白分隔的简写：`P1 命中`
    const bare = raw.split(/\s+/).filter(Boolean);
    if (bare.length >= 2 && /^P\d+$/i.test(bare[0])) return verdictOf(bare[0], bare[1]);
    return null;
  }
  const id = cells[0];
  if (!/^P\d+$/i.test(id)) return null;
  // **`recite-sheet` 生成的表是勾选框形式**（`| P1 | 骨架 | 要点 | [×] | [ ] | [ ] |`），
  // 判定在第 4–6 格而不是第 2 格。两个工具必须接得上，否则"填完表"等于白填。
  // 第一版只读第 2 格，于是填好的表喂进来一条判定都解析不出。
  const boxed = cells.slice(3, 6).map((c) => /\[\s*[×xX✓]\s*\]/.test(c) ? '1' : '0');
  if (boxed.some((b) => b === '1')) {
    const picked = ['命中', '部分', '未中'][boxed.indexOf('1')];
    return verdictOf(id, picked);
  }
  const verdict = cells[1];
  return verdictOf(id, verdict);
}

/** 判定词 → { id, 档, 值 }。同义写法都认。 */
function verdictOf(id, verdict) {
  for (const [pattern, value, label] of CORE) {
    if (pattern.test(verdict)) return { id: id.toUpperCase(), 档: label, 值: value };
  }
  return null;
}

/** 整份表 → { 命中: [], 部分: [], 未中: [], 未判: [] } */
export function parseTable(text) {
  const 命中 = [];
  const 部分 = [];
  const 未中 = [];
  const 未判 = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;      // 同一要点只判一次
    seen.add(parsed.id);
    if (parsed.值 === 1) 命中.push(parsed.id);
    else if (parsed.值 === 0.5) 部分.push(parsed.id);
    else 未中.push(parsed.id);
  }
  return { 命中, 部分, 未中, 未判 };
}

/** 要点表 JSON 里出现、但判定表里没提到的要点 → 记「未判」，不许当未中。 */
export function missingVerdicts(rubric, table) {
  if (!rubric) return [];
  const judged = new Set([...table.命中, ...table.部分, ...table.未中]);
  return rubric.要点.filter((p) => !judged.has(p.id)).map((p) => p.id);
}

function main() {
  const args = process.argv.slice(2);
  // **不能简单取"第一个不以 -- 开头的参数"**：`--s2 2` 里的 `2` 也在其中，会被当成文件名。
  // 第一版这么写，于是 `--s2 2` 时它去读名为 "2" 的文件，读不到就静默退化成 1 条判定。
  const takesValue = new Set(['--rubric', '--s2', '--probe']);
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (takesValue.has(args[i])) { i += 1; continue; }
    if (args[i].startsWith('--')) continue;
    positional.push(args[i]);
  }
  const file = positional[0];
  if (!file) {
    console.error('用法：node recite-from-table.mjs <判分表.md|-> [--rubric 要点表.json] [--s2 N] [--probe 0|1] [--json]');
    process.exit(2);
  }
  const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const rubricPath = args.includes('--rubric') ? args[args.indexOf('--rubric') + 1] : null;
  const rubric = rubricPath ? JSON.parse(fs.readFileSync(rubricPath, 'utf8')) : null;
  const s2 = args.includes('--s2') ? Number(args[args.indexOf('--s2') + 1]) : null;
  const probe = args.includes('--probe') ? Number(args[args.indexOf('--probe') + 1]) : null;

  const table = parseTable(text);
  // 没勾的行也算「未判」——从表里出现过的 P 编号里减去已判的。
  const judgedIds = new Set([...table.命中, ...table.部分, ...table.未中]);
  const seenIdsAll = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/(?:^|[|\s])(P\d+)(?:[|\s]|$)/i);
    if (m) seenIdsAll.add(m[1].toUpperCase());
  }
  const unmarked = [...seenIdsAll].filter((id) => !judgedIds.has(id));
  const missing = rubric ? missingVerdicts(rubric, table) : unmarked;

  // 要点总数：优先用要点表，否则用判定过的条数
  // **分母不能是「判过的条数」**——这一条栽过：`recite-sheet` 生成的表有 18 行，我模拟只勾了
  // 2 行，分母取 2 于是 S1 = 0.75；而真实 S1 是 (1+0.5)/18 = 0.083。**虚高九倍，且从输出
  // 上看不出来。** 分母必须是**要点总数**：有要点表就用它，没有就用"表里出现过的 P 编号条数"
  // （包括没勾的——那说明判分者画了这张表却没填）。
  const seenIds = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/(?:^|[|\s])(P\d+)(?:[|\s]|$)/i);
    if (m) seenIds.add(m[1].toUpperCase());
  }
  const total = rubric ? rubric.要点.length : Math.max(seenIds.size, table.命中.length + table.部分.length + table.未中.length);
  if (total === 0) {
    console.error('一条判定都没解析出来——检查一下判定词的写法（命中/部分/未中）。');
    process.exitCode = 1;
    return;
  }

  // 未判的当「未中」算 S1 是错的；但也不能不算。这里的口径：**按已判的算，并报出未判条数**。
  const answered = table.命中.length + table.部分.length + table.未中.length;
  const s1 = (table.命中.length + 0.5 * table.部分.length) / total;
  // **区间要用真实判定算，不能拿 s1 反推一组合成命中**。
  // 反推会把 12 命中 + 3 部分密化成 13/18，丢掉"部分"的成分，区间就跟着失真。
  // 这里把 s1 还原成"若干个 1 与若干个 0.5"：先放命中的 1，再放部分分。
  const values = [
    ...Array.from({ length: table.命中.length }, () => 1),
    ...Array.from({ length: table.部分.length }, () => 0.5),
    ...Array.from({ length: Math.max(0, total - answered) }, () => 0),
    ...Array.from({ length: Math.max(0, total - answered - table.未中.length) }, () => 0),
  ].slice(0, total);
  while (values.length < total) values.push(0);
  const band = bootstrapS1(
    { 要点: values.map((_, i) => ({ id: `P${i + 1}` })) },
    { 命中: values.map((v, i) => (v === 1 ? `P${i + 1}` : '__none__' + i)),
      部分: values.map((v, i) => (v === 0.5 ? `P${i + 1}` : '__none__' + i)) },
    4000,
  );

  const result = {
    要点总数: total,
    已判: answered,
    未判: missing,
    命中: table.命中.length,
    部分: table.部分.length,
    未中: table.未中.length,
    S1: Number(s1.toFixed(3)),
    S1区间: `[${band.下界}, ${band.上界}]`,
    S2: s2,
    迁移探针: probe,
  };

  if (missing.length > 0) {
    result.警告 = `有 ${missing.length} 条要点没判（${missing.join('、')}）——它们被计入分母但算作未中。` +
      '这不是"未中"，是"没判"。要么补判，要么在报分单里写明。';
  }

  // **闸门落在 S1 的区间里 → 这一次判不出“过/不过”。**
  // 端到端演练时撞到的：S1 = 0.75、区间 [0.556, 0.944]，闸门 0.8 就落在区间内，
  // 而工具照样印「不通过」。那个「不通过」比不说话更糟——它看起来像个判决。
  if (band.下界 <= 0.8 && 0.8 <= band.上界) {
    result.闸门落在区间内 = true;
    result.判定说明 = `S1 = ${result.S1}，区间 [${band.下界}, ${band.上界}] 把闸门 0.8 包在里面——`
      + '这一次判不出「过/不过」。报分时写「S1 = ... （区间 ...），闸门落在区间内，判不出」，'
      + '不要写「不通过」。';
  }

  if (s2 !== null && probe !== null) {
    result.判定 = scoreRecite(
      { 要点: Array.from({ length: total }, (_, i) => ({ id: `P${i + 1}`, 类型: '骨架', 要点: '' })) },
      { 命中: table.命中, 部分: table.部分, 结构档: s2, 迁移探针: probe },
    ).判定;
  }

  // **一条都没判时不许给判定。** 空表跑出来的 S1 = 0、区间 [0,0]、「→ 不通过」——
  // 那三个数全是"什么都没填"的产物，而「不通过」会被当成判决。
  // 这和上一轮那个「闸门落在区间内却印不通过」是同一类：**输出正确，话说错了。**
  if (answered === 0) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ ...result, 判定: null, 判定说明: '一条都没判——先勾选再算' }, null, 2));
    } else {
      console.log(`要点 ${total} 条，**一条都还没判**。`);
      console.log('先把判分表里的三个方括号勾上（命中 / 部分 / 未中 三选一），再跑这个命令。');
    }
    process.exitCode = 1;
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`要点 ${total} 条，已判 ${answered} 条：命中 ${table.命中.length}、部分 ${table.部分.length}、未中 ${table.未中.length}`);
    if (missing.length) console.log(`⚠️ 未判 ${missing.length} 条：${missing.join('、')}`);
    console.log(`S1 = ${result.S1}　95% 区间 ${result.S1区间}`);
    // 闸门落在区间内时，**不印「不通过」**——那个词会被当成判决。
    if (result.闸门落在区间内) {
      console.log(`⚠️ 闸门 0.8 落在区间 [${band.下界}, ${band.上界}] 内 —— 这一次判不出「过/不过」。`);
    } else if (result.判定) {
      console.log(`S2 = ${s2}　探针 = ${probe}　→ ${result.判定}`);
    }
    console.log('\n报分单上就这么写：');
    console.log(`  S1 命题召回 = ${result.S1}（95% 区间 ${band.下界}–${band.上界}）`);
    if (s2 !== null) console.log(`  S2 结构档 = ${s2}／3　　迁移探针 = ${probe}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('recite-from-table.mjs')) main();
