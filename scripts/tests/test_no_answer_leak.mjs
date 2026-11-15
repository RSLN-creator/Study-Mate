/* 判分键与要点表绝不能落进阅读端可读的目录。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：**2026-11-15 我自己差点把它泄了。**

   当时想让「学生不用手动翻文件就能看到卷子」，最省事的做法是把卷子和判分键一起拷进
   `reference/`——阅读端会把它列进「参考资料」。拷完才发现：**判分键里有全部答案。**

   更麻烦的是背默卡：它第 4 节「要点表」是 S1 的尺子，也是答案。整份拷过去一样是泄题。
   而 `assessments/` 阅读端根本不认识——**那正是判分键唯一的防线**。

   判据：
   ① 阅读端可读的目录（`reference/`、`lessons/`）里，不许出现文件名含「判分键」的文件；
   ② 同上目录里不许出现背默卡（要点表在里头）；
   ③ `assessments/` 里的卷子可以给学生看（那是题面），但**卷子不许含要点表**。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function workspaceRoot() {
  return process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
}

/** 递归列出一个目录下的全部文件（不给就返回空）。 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('阅读端可读的目录里不许有判分键（那是泄题）', (t) => {
  const root = workspaceRoot();
  const subjects = path.join(root, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }

  const offenders = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const base = path.join(subjects, subject.name);
    // 阅读端会列出来的两处：reference/（参考资料）与 lessons/（课件）
    for (const readable of ['reference', 'lessons']) {
      for (const file of walk(path.join(base, readable))) {
        const name = path.basename(file);
        if (name.includes('判分键')) {
          offenders.push(`${subject.name}/${readable}/${path.relative(path.join(base, readable), file)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    '判分键出现在阅读端可读的目录里——学生打开「参考资料」就能看见答案：\n' + offenders.join('\n'));
});

test('阅读端可读的目录里不许有背默卡（要点表就是答案）', (t) => {
  const root = workspaceRoot();
  const subjects = path.join(root, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }

  const offenders = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const base = path.join(subjects, subject.name);
    for (const readable of ['reference', 'lessons']) {
      for (const file of walk(path.join(base, readable))) {
        const name = path.basename(file);
        if (name.includes('背默卡')) {
          offenders.push(`${subject.name}/${readable}/${path.relative(path.join(base, readable), file)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    '背默卡第 4 节是要点表（S1 的尺子），进了可读目录等于泄题：\n' + offenders.join('\n'));
});

test('卷子可以给学生看，但卷子本身不许含要点表', (t) => {
  // 卷子的题面是要给学生看的；但要点表是尺子。两者混在一份文件里，就成了「学生手上
  // 拿着尺子做题」——他照着尺子写都能拿高分。
  const root = workspaceRoot();
  const subjects = path.join(root, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }

  const offenders = [];
  let papers = 0;
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('-卷子.md')) continue;
      papers += 1;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      // 卷子里出现「要点表」的表格行（`| P1 | 骨架 |`）就是泄题
      if (/^\|\s*P\d+\s*\|\s*(骨架|因果|术语)\s*\|/m.test(text)) {
        offenders.push(`${subject.name}/${file}`);
      }
    }
  }
  if (papers === 0) { t.skip('工作区里还没有卷子'); return; }
  assert.deepEqual(offenders, [], `这些卷子里带了要点表（学生拿着尺子做题）：\n${offenders.join('\n')}`);
});

test('反证：这条判据必须真报得出来', () => {
  // 没有反证，「判分键不许进 reference」就只是一句永远通过的声明。
  // 而这正是我自己犯过的错：拷过去的那一刻，阅读端的「参考资料」就列出了整个答案。
  const fakeFiles = [
    'reference/学习检验/0003-optics-budget-判分键.md',
    'reference/学习检验/0003-optics-budget-背默卡.md',
    'lessons/0003-optics-budget-判分键.md',
  ];
  const offences = fakeFiles.filter((p) => p.includes('判分键') || p.includes('背默卡'));
  assert.equal(offences.length, 3, '三条都该被认出来');
  // 正例：卷子在 assessments/ 里不算违规
  const ok = 'assessments/0003-optics-budget-卷子.md';
  assert.equal(ok.includes('判分键') || ok.includes('背默卡'), false);
});
