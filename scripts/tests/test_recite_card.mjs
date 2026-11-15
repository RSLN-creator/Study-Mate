/* 背默卡的要点表必须与课件对得上。
   ────────────────────────────────────────────────────────────────────────
   为什么值得单有一条：要点表是 S1 的尺子。**表里任何一条如果课件里根本没有，那它就是编的**
   ——评分者会拿一条学生不可能答出的要点去扣分，而学生连"这条不在课件里"都说不清。

   这是一类很难自己发现的错：编出来的要点读起来和真的完全一样。所以判据不看措辞，看数字：
   **每条要点里出现的 2 位以上数字，至少一半必须在课件原文里出现过。**

   它同时守住三件事：
   ① 要点数量够 15 条（少于 15 条时 S1 的闸门辨别力不够，见判分键）；
   ② 要点表里三类都有（骨架 / 因果 / 术语）——只有术语的要点表测不出结构；
   ③ 每条要点都是可判真假的断言，不是"这一节讲了视场角"这类目录句。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 工作区里的「背默卡 + 课件」配对。没有工作区时返回空。 */
function pairs() {
  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  if (!fs.existsSync(subjects)) return [];
  const found = [];
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('-背默卡.md')) continue;
      const stem = file.replace(/-背默卡\.md$/, '');
      const lesson = path.join(subjects, subject.name, 'lessons', `${stem}.md`);
      found.push({ card: path.join(dir, file), lesson, name: `${subject.name}/${file}` });
    }
  }
  return found;
}

/** 从卡里读出要点表：`| P1 | 骨架 | ... |`。 */
export function readPoints(cardText) {
  return [...cardText.matchAll(/^\| P(\d+) \| (骨架|因果|术语) \| (.+?) \|$/gm)]
    .map((m) => ({ n: Number(m[1]), type: m[2], text: m[3] }));
}

test('骨架里那份空白背默卡在，且它的要点表是空的（空白卡不该带要点）', () => {
  const template = fs.readFileSync(path.join(ROOT, 'templates', 'closed-book', '背默卡.md'), 'utf8');
  assert.match(template, /要点表/, '骨架里要有要点表这一节');
  const points = readPoints(template);
  assert.equal(points.length, 0, `骨架是空白的，不该预填要点（读出了 ${points.length} 条）`);
});

test('真背默卡的要点表：数量够、三类齐、每条都可判真假', (t) => {
  const found = pairs();
  if (found.length === 0) {
    t.skip('工作区里还没有背默卡');
    return;
  }
  const problems = [];
  for (const { card, name } of found) {
    const points = readPoints(fs.readFileSync(card, 'utf8').replaceAll('\r\n', '\n'));
    if (points.length < 15) {
      problems.push(`${name}：只有 ${points.length} 条要点（至少 15 条，否则 S1 闸门辨别力不够）`);
    }
    const kinds = new Set(points.map((p) => p.type));
    for (const kind of ['骨架', '因果', '术语']) {
      if (!kinds.has(kind)) problems.push(`${name}：缺「${kind}」类要点`);
    }
    // 「这一节讲了 X」这类目录句不是可判真假的断言
    const catalogue = points.filter((p) => /这一节|本节|讲了|介绍了/.test(p.text));
    if (catalogue.length > 0) problems.push(`${name}：有目录句而不是断言：${catalogue.map((p) => 'P' + p.n).join(',')}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('要点里的关键数字必须能在课件里找到（不许编）', (t) => {
  const found = pairs();
  if (found.length === 0) {
    t.skip('工作区里还没有背默卡');
    return;
  }
  const problems = [];
  for (const { card, lesson, name } of found) {
    if (!fs.existsSync(lesson)) {
      problems.push(`${name}：找不到对应课件 ${path.basename(lesson)}`);
      continue;
    }
    const text = fs.readFileSync(lesson, 'utf8');
    for (const point of readPoints(fs.readFileSync(card, 'utf8').replaceAll('\r\n', '\n'))) {
      const numbers = [...point.text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]).filter((s) => s.length >= 2);
      if (numbers.length === 0) continue;
      // **数字要按完整边界匹配，不能用 `includes`**：实测踩过——编造的「4.2 nA」被判成"在课件里"，
      // 因为它命中了「74.2 mm」与「4.21°」里的片段。子串匹配让这条判据形同虚设。
      const hit = numbers.filter((n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(text));
      if (hit.length * 2 < numbers.length) {
        problems.push(`${name} P${point.n}：数字 ${numbers.join('、')} 只有 ${hit.length} 个在课件里——这条要点可能是编的`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('要点表不许学生改：卡里要有这句话', (t) => {
  const found = pairs();
  if (found.length === 0) { t.skip('工作区里还没有背默卡'); return; }
  const missing = found.filter(({ card }) => !/这张表不许学生改|不许学生改/.test(fs.readFileSync(card, 'utf8')));
  assert.deepEqual(missing.map((p) => p.name), [], '要点表是尺子，卡里必须写明学生不能改它');
});

test('反证：编造的数字必须被这条判据抓到（子串匹配会让它失效）', () => {
  // 实测踩过的坑：编造「这台机器的量子效率是 87.3%，暗电流 4.2 nA」时，判据判它"在课件里"——
  // 因为「4.2」命中了课件的「74.2 mm」与「4.21°」。**用 includes 等于没判。**
  // 现在按完整数字边界匹配，这个反证钉住它不再退回去。
  const lessonText = '覆盖 9.60 m，400 px/m，人脸 64 px，1.69°，4.21°，74.2 mm';
  const wordHit = (n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(lessonText);
  assert.equal(wordHit('4.2'), false, '「4.2」不该命中「74.2」或「4.21」');
  assert.equal(wordHit('9.60'), true, '真在课件里的数要命中');
  assert.equal(wordHit('1.69'), true);
});

test('要点表必须交代覆盖了哪几节、以及哪一节有意没覆盖', (t) => {
  // 18 条要点不可能覆盖课件每一节，而「没覆盖」与「漏了」看起来一样。
  // 实测踩到：`0003` 的第 9 节「手算脚本」没有要点——那一节要的是"跑得起来"，
  // 背默卡测的是"写得出什么"，两者本来不重合。**这是有意的，但卡上必须写出来**；
  // 不写，下一个人会以为要点表不全，去补一条编的。
  const found = pairs();
  if (found.length === 0) { t.skip('工作区里还没有背默卡'); return; }
  const problems = [];
  for (const { card, lesson, name } of found) {
    const text = fs.readFileSync(card, 'utf8');
    if (!fs.existsSync(lesson)) continue;
    const heads = [...fs.readFileSync(lesson, 'utf8').matchAll(/^## (.+)$/gm)]
      .map((m) => m[1]).filter((h) => !/原文在哪儿|三句要能说出来/.test(h));
    // 卡上要有一句「覆盖课件 X 节里的 Y 节」或「第 N 节…没有对应的要点」
    const coverageClaim = /覆盖课件[^。]{0,20}节|没有对应的要点|有意没覆盖/;
    if (!coverageClaim.test(text) && heads.length > 6) {
      problems.push(`${name}：课件有 ${heads.length} 节，卡上要交代覆盖到哪几节、哪几节有意没覆盖`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('要点条数在三处必须一致（15–20），且不许写成 8–15', () => {
  // 「要点表多少条」这个数**写在三个地方**：协议（layered-practice）、角色规格
  // （practice-evaluator）、骨架（背默卡.md）。第十六轮算清了 8 条不够——S1 半宽 0.31，
  // 0.8 这条闸门线完全分辨不了。改完之后三处各写着不同的数（15–20 / 15–20 / 8–15），
  // 是这条断言把它们拉齐的。**同一个数写在三处，不改全就是假话。**
  const files = {
    'layered-practice': path.join(ROOT, 'preset/skills/layered-practice/SKILL.md'),
    'practice-evaluator': path.join(ROOT, 'preset/skills/practice-evaluator/SKILL.md'),
    '背默卡骨架': path.join(ROOT, 'templates/closed-book/背默卡.md'),
  };
  const problems = [];
  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) { problems.push(`${name}：文件不在`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const found = [...new Set([...text.matchAll(/(\d+)\s*[–-]\s*(\d+)\s*条/g)].map((m) => m[0]))];
    if (found.length === 0) { problems.push(`${name}：没写要点条数`); continue; }
    for (const count of found) {
      if (!count.startsWith('15')) problems.push(`${name}：写着「${count}」，应当是 15–20（8 条不够）`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});