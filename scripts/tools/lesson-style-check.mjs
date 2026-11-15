#!/usr/bin/env node
/* 讲法体检：按 `lesson-design` §三 的六条判据，给一份课件做**非阻断提醒**。
 *
 * 为什么要有它：§三 的四条是「写法」判据，光写在规范里没法看出违没违。这个脚本把它变成
 * 一句句可核对的话。**它只提醒，不改文件、不阻断入库**——与内容校验器同级。
 *
 * 六条判据（出处见规范 §三）：
 *   1. 起笔：这一节第一段是不是「本节介绍……」这类概括（那是目录不是起笔）
 *   2. 回收：起笔摆出的疑问，末段有没有回收（粗判：末段有没有回指起笔的关键词）
 *   3. 篇幅：一节 > 4000 字要复核
 *   4. 并列：一节里 ≥3 个同类并列对象要拆或合并
 *   5. 符号：新符号出现的那一段还没做过具体计算时，超过 3 个要提醒
 *   6. 类比：出现「就像/好比/如同/相当于」而没有「但它/不过这里/只在这一处」这类断点声明
 *
 * 用法：node lesson-style-check.mjs <课件.md> [--json]
 */
import fs from 'node:fs';

const STOP_HEADING = /^##\s+原文在哪儿$|^##\s+三句要能说出来$/;

/** 按 `## ` 切节；`原文在哪儿` 与 `三句要能说出来` 是固定收尾，不算内容节。 */
export function sections(markdown) {
  const lines = markdown.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] };
      out.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return out
    .filter((section) => !STOP_HEADING.test(`## ${section.title}`))
    .map((section) => ({
      title: section.title,
      body: section.lines.join('\n'),
      // 正文字数只算散文：去掉围栏、表格行、图块字段
      chars: countProseChars(section.lines.join('\n')),
      paragraphs: section.lines.join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    }));
}

function countProseChars(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .filter((line) => !/^\s*(alt|caption):/.test(line))
    .filter((line) => !/^:::/.test(line))
    .join('\n');
  return (clean.match(/[\u4e00-\u9fff]/g) || []).length;
}

/* ── 判据 1：起笔是概括还是具体 ─────────────────────────────────────── */
const GENERIC_OPENER = /^(本节|这一节|本课|这一课)(将|会|主要|只)?(介绍|讲|讨论|说明|给出|阐述)/;
const EMPTY_SCENE = /^(桌上是|手边有|设|假设|请看|先看)/;

function checkOpener(section) {
  const first = firstProseParagraph(section);
  if (!first) return null;
  if (GENERIC_OPENER.test(first)) {
    return { 判据: '起笔', 级: '提醒', 节: section.title,
      说: `起笔是概括句：「${first.slice(0, 30)}…」。那是目录不是起笔——换成摆矛盾／先给会失败的老办法／给一个做不到的处境／先给两组对不上的数。` };
  }
  return null;
}

function firstProseParagraph(section) {
  for (const paragraph of section.paragraphs) {
    if (/^:::|^```|^\||^>|^!\[/.test(paragraph)) continue;
    return paragraph.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
  }
  return '';
}

/* ── 判据 2：末段有没有回收起笔 ──────────────────────────────────────── */
const BACKREFERENCE = /(回到|开头|本节一开始|上面那个|前面那个|一开始那个|最初|起先|第一段|这个问题|那个疑问|所以.{0,6}多|这就是为什么)/;

function checkBackReference(section) {
  const first = firstProseParagraph(section);
  if (!first) return null;
  // 起笔本身就是一句话的场景描述（不是提问）时，不强制"回收"
  const isQuestion = /[？?]/.test(first) || EMPTY_SCENE.test(first);
  if (!isQuestion) return null;
  const tail = lastProseParagraph(section);
  if (!tail) return null;
  if (BACKREFERENCE.test(tail)) return null;
  return { 判据: '回收', 级: '提醒', 节: section.title,
    说: '起笔摆了一个处境或疑问，末段没有回指它——要么末段把它解释掉，要么这一节讲漏了东西。' };
}

function lastProseParagraph(section) {
  for (let i = section.paragraphs.length - 1; i >= 0; i -= 1) {
    const paragraph = section.paragraphs[i];
    if (/^:::|^```|^\||^>/.test(paragraph)) continue;
    return paragraph;
  }
  return '';
}

/* ── 判据 3 / 4：篇幅与并列 ─────────────────────────────────────────── */
const ENUMERATION_HEADING = /五段|四条|三类|五种|四类|六类|三条|两条|四种|三种/;

function checkLength(section) {
  if (section.chars <= 4000) return null;
  return { 判据: '篇幅', 级: '提醒', 节: section.title,
    说: `这一节 ${section.chars} 字，超过 4000 的复核线（本科目 p90 = 3626）。问一句：这一节是不是该拆。` };
}

function checkEnumeration(section) {
  // **只看标题，不数表格列**：一张 6 列的对照表是好事不是缺陷，把它算成"并列罗列"会让
  // 这条判据在几乎每一节上都报一次，真正该看的那几节反而被淹没。判据的靶子是
  // 「标题本身就写着 N 个东西并列」，那是这一节的着眼点不唯一的直接证据。
  if (!ENUMERATION_HEADING.test(section.title)) return null;
  return { 判据: '并列', 级: '提示', 节: section.title,
    说: '标题就是"N 个东西并列"。要么拆成 N 节，要么节首给一张总表、节内每个对象只写"与总表不同的那一点"。' };
}

/* ── 判据 5：一段里新符号太多且没有具体计算 ─────────────────────────── */
/* 只认**单字母或带下标的短符号**（f、D、w、p、N、n、W、HFOV、f_px）。
 * 不认 LaTeX 命令：`\frac`、`\cdot`、`\arctan` 是排版指令不是符号——把它们算进来，
 * 每一段有公式的正文都会超限，判据就废了。 */
const LATEX_COMMAND = /^\\(?:frac|cdot|arctan|tan|sqrt|mathrm|text|times|div|approx|le|ge|neq|left|right|qquad|quad|Delta|mu|varepsilon|theta|omega|lambda|pi)$/;
const SYMBOL_TOKEN = /^[A-Za-z](?:_[A-Za-z0-9]+)?$|^[A-Z]{2,6}(?:_[A-Za-z0-9]+)?$/;

function countSymbols(paragraph) {
  const found = new Set();
  for (const match of paragraph.matchAll(/`([A-Za-z_][\w.]*)`/g)) {
    if (SYMBOL_TOKEN.test(match[1])) found.add(match[1]);
  }
  for (const match of paragraph.matchAll(/\$([^$\n]{1,60})\$/g)) {
    for (const token of match[1].matchAll(/\\[A-Za-z]+|[A-Za-z]+/g)) {
      const word = token[0];
      if (word.startsWith('\\')) {
        if (LATEX_COMMAND.test(word)) continue;
        found.add(word);
        continue;
      }
      if (SYMBOL_TOKEN.test(word)) found.add(word);
    }
  }
  return found;
}

function checkSymbolFlood(section) {
  const issues = [];
  let calculated = false;
  for (const paragraph of section.paragraphs) {
    // "做过具体计算"：出现等号且右边是数字，或两个数之间出现了乘除
    if (/=\s*-?[\d.]/.test(paragraph) || /[\d.]\s*[×÷*/]\s*[\d.]/.test(paragraph)) calculated = true;
    if (calculated) continue;
    const symbols = countSymbols(paragraph);
    if (symbols.size > 3) {
      issues.push({ 判据: '符号', 级: '提醒', 节: section.title,
        说: `还没做过一次具体计算，这一段就进了 ${symbols.size} 个符号（${[...symbols].slice(0, 6).join('、')}…）。一次别进太多——先给一个能算出数的例子，把符号挂上去。` });
      break;
    }
  }
  return issues;
}

/* ── 判据 6：类比没有断点声明 ────────────────────────────────────────── */
const ANALOGY = /(就像|好比|如同|相当于|类似于|像是|打个比方|可以想成)/;
const ANALOGY_BREAK = /(但它|不过这里|只在这|到这里就|不能推广|只在[^。]{0,10}成立|类比到此|断在|不准|不成立|不等于)/;

function checkAnalogy(section) {
  const issues = [];
  for (const paragraph of section.paragraphs) {
    if (!ANALOGY.test(paragraph)) continue;
    // 断点声明可以出现在同段，也可以出现在紧接着的下一段
    const at = section.paragraphs.indexOf(paragraph);
    const window = [paragraph, section.paragraphs[at + 1] || ''].join('\n');
    if (ANALOGY_BREAK.test(window)) continue;
    issues.push({ 判据: '类比', 级: '提醒', 节: section.title,
      说: `出现类比（${(paragraph.match(ANALOGY) || [''])[0]}）但紧跟的一两段里没有"它在哪儿断掉"的声明。没有断点声明的类比是已知会制造误解的做法（PRPER 10.1103/ch6t-qvz6）。` });
    break;
  }
  return issues;
}

/* ── 汇总 ───────────────────────────────────────────────────────────── */

export function inspect(markdown) {
  const found = [];
  for (const section of sections(markdown)) {
    for (const check of [checkOpener, checkBackReference, checkLength, checkEnumeration, checkSymbolFlood, checkAnalogy]) {
      const result = check(section);
      if (!result) continue;
      if (Array.isArray(result)) found.push(...result);
      else found.push(result);
    }
  }
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('lesson-style-check.mjs')) {
  const target = process.argv[2];
  if (!target) { console.error('用法：node lesson-style-check.mjs <课件.md> [--json]'); process.exit(2); }
  const found = inspect(fs.readFileSync(target, 'utf8'));
  if (process.argv.includes('--json')) console.log(JSON.stringify(found, null, 2));
  else if (found.length === 0) console.log('讲法体检：没有提醒。');
  else {
    console.log(`讲法体检：${found.length} 条提醒（非阻断）\n`);
    for (const item of found) console.log(`[${item.级}] ${item.判据} · ${item.节}\n    ${item.说}\n`);
  }
}
