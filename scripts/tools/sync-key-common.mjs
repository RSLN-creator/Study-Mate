#!/usr/bin/env node
/* 判分键的「共用段落」同步：把骨架里那几节原样搬进每一份真判分键。
 *
 * 为什么要有它：判分键有两类内容——
 *   · **这一课专属**：每道题的答案与判分要点（题目、满分、给分口径）；
 *   · **全篇共用**：计分总则、三条判定带、半宽与局限、背默卡计分、S1 分辨率。
 *
 * 第二类只有一处定义（骨架）。但前十四轮里我改过骨架三次（半宽 ±8 → 14–19 → 6–19、
 * 加背默卡计分、加 S1 分辨率），**每一次都忘了同步到真判分键**——成品停在旧数字上。
 *
 * 这个工具做两件事：
 *   `--check`：逐份比对共用段落的指纹，不同就报出来（门禁用这个）；
 *   `--write`：把骨架的共用段落搬进真判分键，保留每份专属部分。
 *
 * 用法：
 *   node sync-key-common.mjs --check
 *   node sync-key-common.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = path.join(ROOT, 'templates/closed-book/判分键.md');

/** 共用段落：**只有这些是逐字相同的**。
 *
 * 前三个（计分总则 / 分数怎么读）**不能整段同步**——实测发现每一份真判分键在里头都夹了
 * 本课专属口径：
 *   · `0002` 的计分总则多一条「本卷允许答得比课件更深」；
 *   · `0002` 的「分数怎么读」里五部分说明是按「五问与两个词」写的；
 *   · `0005` 与 `0002` 的「为什么单列迁移线」各自讲了本课的迁移是什么。
 *   **整段同步会把它们全抹掉。** 所以只同步真正逐字相同的那一节——背默卡计分。
 */
/** **只同步整块**，不逐个 `###` 同步。
 *
 * 踩过两次：
 *   · 把 `###` 子节单列出来，会与它所属的 `##` 段重叠切分（同一段内容被切两次，同步完
 *     仍报"漂移"）；
 *   · `## 背默卡的计分` 后面跟着四个 `###` 子节（三个分数 / 逐条判三档 / S2 / S1 分辨率 /
 *     失败的修法），它们**都属于这一节**——切到下一个同级 `##` 才是对的。
 * 所以这张表只留一个条目：整节搬。
 */
export const COMMON_SECTIONS = [
  '## 背默卡的计分（这张卡没有题，只有要点表）',
];

/** 只比对、不同步的段落：这些段落里**有该同步进来的共用事实**（如半宽），也有本课专属内容。 */
export const WATCHED_SECTIONS = ['## 计分总则', '## 分数怎么读'];

/** 从一份判分键里切出共用段落：返回 { 标题: 正文 }。 */
export function splitCommon(text) {
  const out = {};
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  for (const heading of COMMON_SECTIONS) {
    const start = lines.findIndex((line) => line === heading);
    if (start < 0) continue;
    // 到**下一个同级或更高级**的标题为止：`##` 段切到下一个 `##`，`###` 段切到下一个
    // `##` 或 `###`。原来是统一切到 `##`，于是 `## 背默卡的计分` 把它的两个 `###` 子节
    // 一起吞了，切出来的内容重复，同步完仍然"漂移"。
    const level = (line) => (/^(#{2,6})\s/.exec(line) || [null, ''])[1].length;
    const myLevel = level(heading);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^#{2,6}\s/.test(lines[i]) && level(lines[i]) <= myLevel) { end = i; break; }
    }
    out[heading] = lines.slice(start, end).join('\n').trimEnd();
  }
  return out;
}

/** 一段正文的指纹（忽略行尾与首尾空白，免得 CRLF 造成假差异）。 */
export function fingerprint(section) {
  const normalized = String(section || '').replaceAll('\r\n', '\n').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** 工作区里全部真判分键。 */
export function realKeys() {
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  // **没有工作区时返回 null 而不是空数组**：空数组的意思是「查过了，没问题」，
  // 而「根本没东西可查」是另一件事——混成前者，门禁在 CI 上会假装通过。
  if (!fs.existsSync(subjects)) return null;
  const found = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.includes('判分键') && file.endsWith('.md')) found.push({ name: `${subject.name}/${file}`, file: path.join(dir, file) });
    }
  }
  return found;
}

/** 比对：返回 [{ name, 缺的段, 指纹不同的段 }]；**没有工作区时返回 null**（不是空数组）。 */
export function check() {
  const templateText = fs.readFileSync(TEMPLATE, 'utf8');
  const expected = splitCommon(templateText);
  const keys = realKeys();
  if (keys === null) return null;
  const problems = [];
  for (const { name, file } of keys) {
    const actual = splitCommon(fs.readFileSync(file, 'utf8'));
    const missing = [];
    const drifted = [];
    for (const heading of COMMON_SECTIONS) {
      if (!(heading in expected)) continue;
      if (!(heading in actual)) { missing.push(heading); continue; }
      if (fingerprint(actual[heading]) !== fingerprint(expected[heading])) drifted.push(heading);
    }
    if (missing.length || drifted.length) problems.push({ name, missing, drifted });
  }
  return problems;
}

/** 把骨架的共用段落搬进真判分键。返回每份改了什么；没有工作区时返回空数组。 */
export function sync() {
  const templateText = fs.readFileSync(TEMPLATE, 'utf8');
  const expected = splitCommon(templateText);
  const keys = realKeys();
  if (keys === null) return [];
  const changed = [];
  for (const { name, file } of keys) {
    const original = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    let text = original;
    const lines = text.split('\n');
    for (const heading of COMMON_SECTIONS) {
      if (!(heading in expected)) continue;
      const block = expected[heading];
      const start = lines.findIndex((line) => line === heading);
      if (start < 0) {
        // 真判分键里没有这一节：追加到末尾（共用段落放在最后不会打断专属题目）
        lines.push('', block);
        continue;
      }
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        if (lines[i].startsWith('## ')) { end = i; break; }
      }
      lines.splice(start, end - start, ...block.split('\n'), '');
    }
    text = lines.join('\n');
    if (text !== original) {
      fs.writeFileSync(file, text, 'utf8');
      changed.push(name);
    }
  }
  return changed;
}

if (process.argv[1] && process.argv[1].endsWith('sync-key-common.mjs')) {
  const write = process.argv.includes('--write');
  if (write) {
    const changed = sync();
    console.log(changed.length ? `已同步：\n${changed.join('\n')}` : '全部已是最新。');
  } else {
    const problems = check();
    if (problems === null) { console.log('没有学习工作区，跳过。'); process.exitCode = 0; }
    else if (problems.length === 0) console.log('全部判分键的共用段落与骨架一致。');
    else {
      for (const p of problems) {
        console.log(`${p.name}`);
        if (p.missing.length) console.log(`  缺：${p.missing.join('、')}`);
        if (p.drifted.length) console.log(`  漂移：${p.drifted.join('、')}`);
      }
      process.exitCode = 1;
    }
  }
}
