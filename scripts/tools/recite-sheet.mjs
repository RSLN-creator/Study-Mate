#!/usr/bin/env node
/* 从要点表生成一张空白的判分表——判分者照着填，不用自己画。
 *
 * 为什么要有它：判 18 条要点时，判分者手上应该已经有一张这样的表：
 *     P1  骨架  <要点原文>   [ ]命中 [ ]部分 [ ]未中
 *     ...
 * 而不是自己从头画一张。**画表这一步没有任何判断成分，纯粹是体力活，
 * 而体力活正是让人放弃的地方。**
 *
 * 用法：
 *   node recite-sheet.mjs <要点表.json> [--out 判分表.md]
 *   node recite-sheet.mjs <背默卡.md>   # 直接从卡里抠要点表
 *
 * 生成的表填完之后，直接喂给 `recite-from-table.mjs`（它认 `P1 命中` 这种行）。
 */
import fs from 'node:fs';

/** 从背默卡 markdown 里抠出要点表：`| P1 | 骨架 | ... |` */
export function pointsFromCard(cardText) {
  return [...cardText.replaceAll('\r\n', '\n').matchAll(/^\|\s*(P\d+)\s*\|\s*(骨架|因果|术语)\s*\|\s*(.+?)\s*\|$/gm)]
    .map((m) => ({ id: m[1], 类型: m[2], 要点: m[3].trim() }))
    // **空正文的行不算要点**：骨架里为了让人照着填，会留 `| P1 | 骨架 | |` 这样的空行。
    // 不过滤的话，从骨架生成判分表会得到一堆没有内容的条目。
    .filter((p) => p.要点.length > 0);
}

/** 生成空白判分表。 */
export function buildSheet(points) {
  const lines = [];
  lines.push('# 背默判分表（空白）');
  lines.push('');
  lines.push('> 逐条判。每行把三个方括号里的一个改成 × ，其余留空。');
  lines.push('> 三档口径见判分键「背默卡的计分」：**命中** = 核心关系写出来了；**部分** = 有成分但缺方向/条件/连接；**未中** = 未提及、或与要点相反。');
  lines.push('> **只写了一个关键词、没写出它与其他量的关系 → 记部分，不记未中。**');
  lines.push('> 填完存成 `.md`，跑 `node scripts/tools/recite-from-table.mjs 这张表.md --s2 <档> --probe <0/1>`。');
  lines.push('');
  lines.push('| 要点 | 类型 | 要点原文 | 命中 | 部分 | 未中 | 理由（一句话） |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const point of points) {
    lines.push(`| ${point.id} | ${point.类型} | ${point.要点} | [ ] | [ ] | [ ] | |`);
  }
  lines.push('');
  lines.push('## 整体判断（不在逐条里）');
  lines.push('');
  lines.push('| 项 | 值 | 判据 |');
  lines.push('| --- | --- | --- |');
  lines.push('| **S2 结构档** | ____ （0–3） | 3 = 骨架顺序对 + 每条因果有方向 + 至少一处等价表述；2 = 骨架基本对但缺 1 处；1 = 有词条但看不出骨架；**0 = 字面搬运（整段接近原文措辞而无结构标记）或空白** |');
  lines.push('| **迁移探针** | ____ （0/1） | 答对了「改掉一个前提会怎样」那句 = 1 |');
  lines.push('');
  lines.push('**「字面搬运」判 S2 = 0 是有意的**：抄原文能拿满 S1（要点表里的句子本来就在原文里），但过不了结构档。');
  lines.push('');
  lines.push('## 判得最没把握的一条');
  lines.push('');
  lines.push('| 要点 | 拿不准什么 |');
  lines.push('| --- | --- |');
  lines.push('| | |');
  lines.push('');
  lines.push('> **这一栏不许空着。**');
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('recite-sheet.mjs')) {
  const args = process.argv.slice(2);
  // **不能取"第一个不以 -- 开头的参数"再排除 --out 的值**：`--out x.md` 时 x.md 也不以 -- 开头，
  // 而排除逻辑依赖 indexOf('--out') 的位置关系，写错就把真正的输入文件也排掉了。
  // 正确做法：遍历时跳过每个带值选项的**下一个**参数。
  const takesValue = new Set(['--out']);
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (takesValue.has(args[i])) { i += 1; continue; }
    if (args[i].startsWith('--')) continue;
    positional.push(args[i]);
  }
  const file = positional[0];
  if (!file) {
    console.error('用法：node recite-sheet.mjs <要点表.json|背默卡.md> [--out 判分表.md]');
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf8');
  const points = file.endsWith('.json')
    ? (JSON.parse(text).要点 || [])
    : pointsFromCard(text);
  if (points.length === 0) {
    console.error(`没能从 ${file} 里读出要点表——背默卡要有一节「要点表」，行形如 | P1 | 骨架 | …… |`);
    process.exitCode = 1;
  } else {
    const sheet = buildSheet(points);
    const outIndex = args.indexOf('--out');
    if (outIndex >= 0) {
      fs.writeFileSync(args[outIndex + 1], sheet, 'utf8');
      console.log(`已写 ${args[outIndex + 1]}（${points.length} 条要点）`);
    } else {
      console.log(sheet);
    }
  }
}
