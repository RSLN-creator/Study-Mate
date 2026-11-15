#!/usr/bin/env node
/* 评分者一致性：判分键到底是不是一把「可复现的尺子」。
 *
 * 为什么要有它：判分键写得再细，如果三个评分者用它评同一份答卷给出三个不同的分，
 * 那这把尺子就不能用——分数不可比，前面所有「半宽」「判定带」的讨论都白费。
 * 这一步是「按分评分」里**唯一能自动化的那一半**：学生那一半要人答，这一半可以现在测。
 *
 * 三种统计量，各回答一个问题：
 *   · **ICC(2,k)**（双向随机、绝对一致性、k 个评分者的均值）：评分的整体一致性。
 *     用绝对一致（而非一致性）是因为我们要的是「分数能不能比」，不是「排序对不对」。
 *   · **Krippendorff α**（区间数据）：对缺失值与评分者数不敏感，是内容分析的标准。
 *     判读阈值：α ≥ 0.80 可下结论；0.667–0.80 只能作暂定；< 0.667 不可用。
 *   · **逐题极差**：哪几题的判定分歧最大——那几题的判分要点写得不够死。
 *
 * 用法：node rater-agreement.mjs <评分表.csv>
 *   CSV 头一行是 `题号,满分,rater-a,rater-b,rater-c`，一行一题。
 */
import fs from 'node:fs';

/** 读 CSV：`题号,满分,rater-a,rater-b,...`。空单元当作缺失（不是 0）。 */
export function readRatings(text) {
  const lines = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  const header = lines[0].split(',').map((s) => s.trim());
  const raters = header.slice(2);
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    return {
      题号: cells[0],
      满分: Number(cells[1]),
      分: raters.map((_, i) => (cells[i + 2] === '' || cells[i + 2] === undefined ? null : Number(cells[i + 2]))),
    };
  });
  return { raters, rows };
}

/** ICC(2,k)：双向随机效应、绝对一致性、k 个评分者均值的信度。
 *
 * 公式（Shrout & Fleiss 1979 的 ICC(2,k) / McGraw & Wong 的 ICC(A,k)）：
 *   MSR = 题间均方，MSC = 评分者间均方，MSE = 残差均方
 *   ICC(2,k) = (MSR − MSE) / (MSR + (MSC − MSE) / n)
 * 取值范围 0–1（可为负）。
 *
 * **第一版写错过一次**：漏了 `(MSR − MSE) / k` 那一步的归一，用三份差很大的评分跑出
 * ICC = 49.5——ICC 不可能大于 1。所以下面加了一条范围断言，跑出界就是算错了。
 */
export function icc2k(rows) {
  const complete = rows.filter((r) => r.分.every((v) => v !== null));
  const n = complete.length;
  const k = complete[0]?.分.length ?? 0;
  if (n < 2 || k < 2) return { icc: null, 说明: '可用行或评分者不足' };

  const grand = complete.reduce((s, r) => s + r.分.reduce((a, b) => a + b, 0), 0) / (n * k);
  const rowMeans = complete.map((r) => r.分.reduce((a, b) => a + b, 0) / k);
  const colMeans = Array.from({ length: k }, (_, j) => complete.reduce((s, r) => s + r.分[j], 0) / n);

  const ssRows = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssCols = n * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssTotal = complete.reduce((s, r) => s + r.分.reduce((a, v) => a + (v - grand) ** 2, 0), 0);
  const ssError = ssTotal - ssRows - ssCols;

  const msRows = ssRows / (n - 1);
  const msCols = ssCols / (k - 1);
  const msError = ssError / ((n - 1) * (k - 1));
  const denom = msRows + (msCols - msError) / n;
  if (denom === 0) return { icc: null, 说明: '方差为零' };
  const raw = (msRows - msError) / denom;
  // 范围断言：ICC 必须落在 [−1, 1]。跑出界说明公式或数据形状错了，不能当数用。
  //
  // **容差 1e-9 是必须的**：三位评分者完全一致时（残差均方为 0），算出来是
  // 0.9999999999… 或 1.0000000001，硬边界会把这份**最好的数据**判成「公式有问题」。
  // 实测踩过：复评后三人 13 题逐题完全一致，ICC 却报 null。
  if (!(raw >= -1 - 1e-9 && raw <= 1 + 1e-9)) {
    return { icc: null, 说明: `算出的 ICC=${raw.toFixed(3)} 越界，公式或数据形状有问题` };
  }
  return { icc: Number(Math.min(1, Math.max(-1, raw)).toFixed(3)), n, k };
}

/** Krippendorff α，区间（interval）度量。缺失值按对可用处理。 */
export function krippendorffAlpha(rows) {
  // 收集所有值对（同一题内）
  const pairs = [];
  const values = [];
  for (const row of rows) {
    const present = row.分.filter((v) => v !== null);
    for (const v of present) values.push(v);
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) pairs.push([present[i], present[j]]);
    }
  }
  if (pairs.length === 0) return { alpha: null, 说明: '没有可用的评分对' };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  // 观测的不一致 Do：值对差的平方均值
  const Do = pairs.reduce((s, [a, b]) => s + (a - b) ** 2, 0) / pairs.length;
  // 期望的不一致 De：按边缘分布随机配对的差的平方均值
  let sumSq = 0;
  let count = 0;
  for (const a of values) {
    for (const b of values) {
      sumSq += (a - b) ** 2;
      count += 1;
    }
  }
  const De = sumSq / count;
  if (De === 0) return { alpha: null, 说明: '期望不一致为零（全部同分）' };
  const alpha = 1 - Do / De;
  return { alpha: Number(alpha.toFixed(3)), 均值: Number(mean.toFixed(2)), 对数: pairs.length };
}

/** 逐题极差：哪几题的判定分歧最大。 */
export function perItemSpread(rows) {
  return rows
    .filter((r) => r.分.filter((v) => v !== null).length >= 2)
    .map((r) => {
      const present = r.分.filter((v) => v !== null);
      return { 题号: r.题号, 满分: r.满分, 极差: Math.max(...present) - Math.min(...present), 分: present };
    })
    .sort((a, b) => b.极差 - a.极差);
}

/** α 的判读（Krippendorff 2004, p.241 的口径）。 */
export function alphaVerdict(alpha) {
  if (alpha === null) return '不可判';
  if (alpha >= 0.8) return '可下结论';
  if (alpha >= 0.667) return '只能作暂定结论';
  return '不可用';
}

if (process.argv[1] && process.argv[1].endsWith('rater-agreement.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('用法：node rater-agreement.mjs <评分表.csv>'); process.exit(2); }
  const { raters, rows } = readRatings(fs.readFileSync(file, 'utf8'));
  const icc = icc2k(rows);
  const alpha = krippendorffAlpha(rows);
  console.log(`评分者：${raters.join('、')}　题目数：${rows.length}`);
  console.log(`ICC(2,k) = ${icc.icc ?? '—'}`);
  console.log(`Krippendorff α = ${alpha.alpha ?? '—'}（${alphaVerdict(alpha.alpha)}）`);
  console.log('\n逐题极差（大的 = 那个判分要点写得不够死）：');
  for (const item of perItemSpread(rows)) {
    console.log(`  第 ${item.题号} 题　满分 ${item.满分}　极差 ${item.极差}　${JSON.stringify(item.分)}`);
  }
}
