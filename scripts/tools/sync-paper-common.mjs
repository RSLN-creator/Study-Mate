#!/usr/bin/env node
/* 卷子的「公用段落」同步：把骨架里那一节整块搬进每份真卷子。
 *
 * 为什么要有它：判分键那边早就有了 `sync-key-common.mjs`，卷子这边一直没有。
 * 结果是——**骨架改了三次，真卷子全停在旧内容上**：
 *   · `0003` 连「什么时候再做一次」整节都没有；
 *   · `0005` 与 `0002` 还写着旧的 +1 / +7 / +30，以及那条错的 Cepeda 2008 引用
 *     （第十九轮核原文时改成 +1 / **+11** / +30，骨架改了，真卷子没改）。
 *
 * 卷子的结构与判分键不同：每道题都是这一课专属的，**只有「什么时候再做一次」那一节是共用的**。
 * 所以这里只同步那一节，其余一个字都不碰。
 *
 * 用法：
 *   node sync-paper-common.mjs --check
 *   node sync-paper-common.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = path.join(ROOT, 'templates/closed-book/卷子.md');

/** 卷子里唯一的共用节。改这个常量之前先确认那一节里没有本课专属内容。 */
export const SHARED_SECTION = '## 什么时候再做一次（这一节是建议，不是日程）';

/** 从一份卷子里切出共用节（到下一个 `## ` 之前）。 */
export function splitShared(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => line.startsWith('## 什么时候再做一次'));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/** 工作区里全部真卷子。没有工作区返回 null（不是空数组）。 */
export function realPapers() {
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
      if (file.endsWith('-卷子.md')) found.push({ name: `${subject.name}/${file}`, file: path.join(dir, file) });
    }
  }
  return found;
}

export function check() {
  const expected = splitShared(fs.readFileSync(TEMPLATE, 'utf8'));
  const papers = realPapers();
  if (papers === null) return null;
  const problems = [];
  for (const { name, file } of papers) {
    const actual = splitShared(fs.readFileSync(file, 'utf8'));
    if (actual === null) { problems.push({ name, reason: '缺「什么时候再做一次」整节' }); continue; }
    if (actual !== expected) problems.push({ name, reason: '与骨架不一致（多半是旧的节拍表）' });
  }
  return problems;
}

export function sync() {
  const expected = splitShared(fs.readFileSync(TEMPLATE, 'utf8'));
  const papers = realPapers();
  if (papers === null) return [];
  const changed = [];
  for (const { name, file } of papers) {
    const original = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const actual = splitShared(original);
    if (actual === expected) continue;
    let text;
    if (actual === null) {
      // 没有这一节：插在第一个 `## 一、` 之前
      const marker = '\n## 一、';
      const at = original.indexOf(marker);
      if (at < 0) continue;
      text = original.slice(0, at) + '\n' + expected + '\n\n---\n' + original.slice(at);
    } else {
      text = original.replace(actual, expected);
    }
    if (text !== original) { fs.writeFileSync(file, text, 'utf8'); changed.push(name); }
  }
  return changed;
}

if (process.argv[1] && process.argv[1].endsWith('sync-paper-common.mjs')) {
  if (process.argv.includes('--write')) {
    const changed = sync();
    console.log(changed.length ? `已同步：\n${changed.join('\n')}` : '全部已是最新。');
  } else {
    const problems = check();
    if (problems === null) console.log('没有学习工作区，跳过。');
    else if (problems.length === 0) console.log('全部真卷子的共用节与骨架一致。');
    else {
      for (const p of problems) console.log(`${p.name}：${p.reason}`);
      process.exitCode = 1;
    }
  }
}
