/* 引文必须能追到原话：写进规范的每个「作者 年份：结论」都要有一条可核对的原文。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：**前十七轮的所有文献结论都来自子智能体的报告，我一条都没自己核过。**

   第十八轮自己核了两条，第一条就对上了（Roediger & Karpicke 2006 的 61% vs 40%、
   3.4 次 vs 14.2 次，原文逐字一致），**第二条没对上**：

   · 我写「一个月内要用 → +1 天、+7 天、+30 天，引 Cepeda 2008」；
   · Cepeda et al. 2008 原文（Psychological Science 19(11):1095–1102）是
     「For the RIs of 7, 35, 70, and 350 days, the optimal gaps were 1, 11, 21, and 21 days」——
     **35 天保持期上给的是 11 天，7 与 30 都不是**。

   这是最坏的一类错：**数字看起来像文献值，其实是我编的**，而且它已经进了卷子、判分键与
   结论索引三处，学生会照着它安排复习。

   判据：
   ① 每个「作者 年份」引文必须在 `docs/取证/` 的某份取证记录里出现（没有取证记录就是没核过）；
   ② 引文里出现的数值必须能在取证记录里找到同样的数（防「作者对、数字编」）。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EVIDENCE_DIR = path.join(ROOT, 'docs', '取证');

/** 全部取证记录拼在一起——引文只要能在这里找到出处就算「核过」。 */
function evidenceCorpus() {
  if (!fs.existsSync(EVIDENCE_DIR)) return '';
  return fs.readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8'))
    .join('\n');
}

/** 会写文献结论的那几份文件。 */
const CLAIM_FILES = [
  'docs/设计/学习方法层-结论索引.md',
  'docs/设计/学习方法层.md',
  'templates/closed-book/卷子.md',
  'preset/skills/layered-practice/SKILL.md',
];

test('每个引文的作者姓氏都要在取证记录里出现过', () => {
  const corpus = evidenceCorpus();
  assert.ok(corpus.length > 1000, '取证记录不在或太少——它是这些引文的唯一出处');
  const missing = [];
  for (const rel of CLAIM_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // 抓「Karpicke 2008」「Cepeda 2006」「Roediger & Karpicke 2006」「Bisra 2018」这类
    for (const match of text.matchAll(/([A-Z][a-zA-Z]+)(?:\s*(?:&|and)\s*([A-Z][a-zA-Z]+))?\s*(\d{4})/g)) {
      const [, first, second, year] = match;
      for (const name of [first, second].filter(Boolean)) {
        if (!corpus.includes(name)) {
          missing.push(`${name} ${year}`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    `这些引文没有取证记录（等于没核过）：\n${[...new Set(missing)].join('\n')}`);
});

test('Cepeda 2008 的四个最优间隔必须写对（这是实测抓出来的错）', () => {
  // 论文原话：「For the RIs of 7, 35, 70, and 350 days, the optimal gaps were
  //           1, 11, 21, and 21 days, respectively, for recall」
  const paper = fs.readFileSync(path.join(ROOT, 'templates/closed-book/卷子.md'), 'utf8');
  if (!paper.includes('Cepeda 2008')) return;
  // 至少要把 11 天写进去（35 天保持期的最优间隔）
  assert.match(paper, /\+11 天|\b11 天/, 'Cepeda 2008 在 35 天保持期上的最优间隔是 11 天，卷子里没写');
  // 并且不许出现「+7 天、+30 天」这种把 7 当成 35 天最优间隔的写法
  assert.doesNotMatch(paper, /一个月内要用[^\n]*\+7 天[^\n]*\+30 天/,
    '35 天保持期的最优间隔不是 7 天也不是 30 天——那是把外推当成了文献值');
});

test('取证记录里要留 Cepeda 2008 的原句，否则这条判据自己没依据', () => {
  const corpus = evidenceCorpus();
  assert.match(corpus, /Cepeda/, '取证记录里要提到 Cepeda');
  assert.match(corpus, /1, 11, 21, and 21|1、11、21、21|1, 11, 21, 21/,
    'Cepeda 2008 的四个最优间隔要逐字留在取证记录里——没有原句，这条判据和引文都没有依据');
});

test('「未核」的引文必须被明确标成未核，不许混进已核里', () => {
  // 这条是防止上面那条判据被"登记一下就过"架空：
  // 姓氏出现在取证记录里只说明「有登记」，不说明「核过」。
  // 所以取证记录自己必须把这两类分开——**已核的带原话，未核的进那张表。**
  const corpus = evidenceCorpus();
  const hasUnverifiedTable = /尚未自己核过|未核/.test(corpus);
  assert.ok(hasUnverifiedTable, '取证记录里要有一节明确写着「尚未自己核过」的引文');

  // 已核的那几条必须带原文引号（`"` 或 `>` 引用块）——只有作者名不算核过
  const verifiedBlocks = corpus.split(/^## /m).filter((block) => block.includes('已读'));
  assert.ok(verifiedBlocks.length >= 2, '至少要有一条「已读全文/摘要」的记录');
  for (const block of verifiedBlocks) {
    assert.match(block, /"[^"]{20,}"|>[^\n]{20,}/,
      `「${block.split('\n')[0].slice(0, 30)}」标了已读，但没有留原话`);
  }
});