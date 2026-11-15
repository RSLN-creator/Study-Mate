#!/usr/bin/env node
/* 题目可答性：卷子上每道题问的东西，课件里有没有？
 *
 * 为什么要有它：如果一道题问的数字或概念课件里根本没有，**学生答不出来不是他的问题，
 * 是出题的问题**。而这种题最坑——它看起来完全正常，学生只会以为自己没读懂。
 *
 * 检查三件事（都是"弱信号"，报出来是提醒，不是判决）：
 *   ① **数字**：题干里的 2 位以上数字，课件里有没有（按完整边界匹配，防止「4.2」命中「74.2」）。
 *   ② **引用的式子**：题干里 `` `...` `` 包裹的式子，课件里有没有。
 *   ③ **关键名词**：题干里用 **粗体** 标出的名词，课件里有没有。
 *
 * **不检查"能不能推出来"**——那只有人能做。这个工具只查"题目问的材料在不在课件里"。
 *
 * 用法：
 *   node question-answerable.mjs <卷子.md> <课件.md> [--json]
 *   node question-answerable.mjs --all        # 工作区里全部配对
 */
import fs from 'node:fs';
import path from 'node:path';

/** 从卷子里切出每道题的题干块。 */
export function extractQuestions(paperText) {
  const lines = paperText.replaceAll('\r\n', '\n').split('\n');
  const starts = [];
  lines.forEach((line, index) => { if (/^\*\*\d+\.\*\*/.test(line)) starts.push(index); });
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    let block = lines.slice(start, end).join('\n');
    const cut = block.search(/\n## /);
    if (cut > 0) block = block.slice(0, cut);
    const number = Number((/^\*\*(\d+)\.\*\*/.exec(lines[start]) || [])[1]);
    return { number, text: block };
  });
}

/** 检查一道题问的材料在不在课件里。 */
export function checkQuestion(question, lessonText) {
  const problems = [];

  // **先判断这道题是不是"故意给新参数"的那类。**
  // 迁移题（"假设换一台机器：1/2.8″、1920 像素……"）的参数**本来就不该在课件里**；
  // 而"换算因子取 1240"这种是**题面自己给的常数**，学生也不需要从课件里知道。
  // 第一版把这两类全报成"数字不在课件里"，那是误报——而误报会让这条判据被忽略。
  const givesOwnNumbers = /假设|若|换成|换算因子取|取\s*\d|已知/.test(question.text);
  const providesConstant = (n) => new RegExp(`(因子|常数|取|约)\\s*${n.replace('.', '\\.')}`).test(question.text);

  // ① 数字：完整边界匹配。`4.2` 不许命中 `74.2` 或 `4.21`。
  const numbers = [...new Set([...question.text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]))]
    // **只查"这个题依赖它的数"，不查题面自己给的数据。**
    // `4.2×10¹²` 里的 `12` 是指数；`×10⁻⁸` 里的 `8` 同理；单字符数字（`1`、`3`）
    // 多半是序号或份数。这些都不是"需要课件提供的数值"。
    // 判定：至少 3 个字符，且不紧跟在 `×10` / `x10` 之后。
    .filter((n) => n.length >= 3)
    .filter((n) => {
      const at = question.text.indexOf(n);
      const before = question.text.slice(Math.max(0, at - 4), at);
      return !/[×x]10[-⁻]?$/.test(before);
    });
  const missingNumbers = givesOwnNumbers ? [] : numbers.filter((n) => {
    if (providesConstant(n)) return false;
    const pattern = new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`);
    return !pattern.test(lessonText);
  });

  // ② 题干里用反引号包住的式子
  const formulas = [...new Set([...question.text.matchAll(/`([^`]{3,})`/g)].map((m) => m[1].trim()))];
  const missingFormulas = formulas.filter((f) => !lessonText.includes(f));

  // ③ 题干里用粗体标出的关键名词
  // **粗体不等于术语。** 卷子里的粗体有三种用法：标术语（`像元边长`）、标指令（`任意两种`
  // `逐节打分`）、标题眼（`核心的一句话`）。**只有第一种该查课件里有没有。**
  // 判据：指令类多半是"数量 + 量词"或动词短语（任意/其中/至少/逐节/各/每/写出/说明）。
  const isInstruction = (t) => /任意|其中|至少|至多|逐节|各自|每|写出|说明|举|列出|比较|假设|如果|核心/.test(t);
  const terms = [...new Set([...question.text.matchAll(/\*\*([^*]{2,20})\*\*/g)].map((m) => m[1].trim()))]
    .filter((t) => !isInstruction(t))
    // 再过滤掉不是"名词"的东西：题号（`7.` `12.`）、分数单位（`分`）、小节名（`一、骨架`）。
    // **第一版写的是 `/^\d+$/`，只能匹配纯数字**，于是 `7.` `12.` 这类带点的题号被当名词报出来。
    .filter((t) => !/^[\d.、]+$/.test(t) && !/^[一二三四五]、/.test(t) && !/分$/.test(t));
  // **术语差一个字不该报**：`感光面横向宽度` vs 课件里的 `感光面宽`，学生一眼能对上，
  // 但字面不相等。用「去掉修饰词后的主干」再比一次。
  const normalize = (s) => s.replace(/[（）()「」『』\s]/g, '')
    .replace(/横向|纵向|垂直|水平|绝对|相对|有效|总的|全部的/g, '');
  const termOk = (t) => lessonText.includes(t) || lessonText.includes(normalize(t))
    // 主干再不行，就退一步：取该术语最长的 2–4 字连续片段，看课件里有没有
    || (normalize(t).length >= 3 && (() => {
      const core = normalize(t).slice(0, Math.min(4, normalize(t).length));
      return lessonText.includes(core);
    })());
  const missingTerms = terms.filter((t) => !termOk(t));

  if (missingNumbers.length) problems.push(`数字不在课件里：${missingNumbers.join('、')}`);
  if (missingFormulas.length) problems.push(`式子在课件里找不到原文：${missingFormulas.join(' / ')}`);
  if (missingTerms.length) problems.push(`名词不在课件里：${missingTerms.join('、')}`);
  return { number: question.number, problems };
}

/** 工作区里「卷子 ↔ 课件」的配对。没有工作区返回 null。 */
export function pairs() {
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  if (!fs.existsSync(subjects)) return null;
  const found = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('-卷子.md')) continue;
      const stem = file.replace(/-卷子\.md$/, '');
      const lesson = path.join(subjects, subject.name, 'lessons', `${stem}.md`);
      found.push({ name: `${subject.name}/${file}`, paper: path.join(dir, file), lesson });
    }
  }
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('question-answerable.mjs')) {
  const json = process.argv.includes('--json');
  if (process.argv.includes('--all')) {
    const list = pairs();
    if (list === null) { console.log('没有学习工作区，跳过。'); process.exit(0); }
    let bad = 0;
    for (const { name, paper, lesson } of list) {
      if (!fs.existsSync(lesson)) { console.log(`${name}：找不到课件`); bad += 1; continue; }
      const lessonText = fs.readFileSync(lesson, 'utf8');
      const results = extractQuestions(fs.readFileSync(paper, 'utf8'))
        .map((q) => checkQuestion(q, lessonText)).filter((r) => r.problems.length);
      if (results.length) {
        bad += 1;
        console.log(`\n${name}`);
        for (const r of results) console.log(`  第 ${r.number} 题：${r.problems.join('；')}`);
      }
    }
    console.log(bad === 0 ? '全部题目的材料都能在课件里找到。' : `\n${bad} 份卷子有题目问的材料找不到出处。`);
  } else {
    const [paperPath, lessonPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    if (!paperPath || !lessonPath) {
      console.error('用法：node question-answerable.mjs <卷子.md> <课件.md> [--json]');
      process.exit(2);
    }
    const lessonText = fs.readFileSync(lessonPath, 'utf8');
    const results = extractQuestions(fs.readFileSync(paperPath, 'utf8')).map((q) => checkQuestion(q, lessonText));
    const flagged = results.filter((r) => r.problems.length);
    if (json) console.log(JSON.stringify(flagged, null, 2));
    else if (flagged.length === 0) console.log('每道题问的材料都能在课件里找到。');
    else for (const r of flagged) console.log(`第 ${r.number} 题：${r.problems.join('；')}`);
  }
}
