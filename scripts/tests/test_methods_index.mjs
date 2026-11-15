/* 学习方法层的结论索引必须与代码一致。
   ────────────────────────────────────────────────────────────────────────
   为什么值得单有一条：`docs/设计/学习方法层-结论索引.md` 是「一眼看完这一层全部结论」的表。
   表里每个数字、每个入口名都是**别处算出来的**——它们会漂。

   漂的样子很难看出来：写了「`npm run readability`」，而 package.json 里那个脚本改名了；
   写了「半宽 14–19 分」，而 bootstrap 脚本换了参数。**两者都是"看着像真的"的假话。**

   判据三条：
   ① 表里提到的每个 `npm run <名字>` 必须在 package.json 的 scripts 里存在；
   ② 表里的半宽数值必须与 `closed-book-bootstrap.mjs` 现算的一致；
   ③ 表里点名的文件路径必须真的在盘上。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SCENARIOS, bootstrapTotal, pointsOf } from '../tools/closed-book-bootstrap.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INDEX = path.join(ROOT, 'docs', '设计', '学习方法层-结论索引.md');
const read = () => fs.readFileSync(INDEX, 'utf8').replaceAll('\r\n', '\n');

test('索引在手，且三条方向都在', () => {
  assert.ok(fs.existsSync(INDEX), '结论索引不见了——它是这一层唯一的汇总入口');
  const text = read();
  for (const direction of ['降低正文认知负荷', '检索练习的固定节拍', '合卷背默可评分']) {
    assert.match(text, new RegExp(direction), `索引缺「${direction}」这一条`);
  }
});

test('索引里提到的每个 npm 脚本都真实存在', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
  const mentioned = [...new Set([...read().matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))];
  assert.ok(mentioned.length >= 2, `索引里只提到 ${mentioned.length} 个脚本，少了就说明入口没写`);
  const missing = mentioned.filter((name) => !(name in scripts));
  assert.deepEqual(missing, [], `索引提到了不存在的 npm 脚本：${missing.join('、')}`);
});

test('索引里写的半宽与 bootstrap 脚本现算的一致', () => {
  const widest = Math.max(...SCENARIOS.map((s) => bootstrapTotal(pointsOf(s.spec)).半宽));
  const narrowest = Math.min(...SCENARIOS.map((s) => bootstrapTotal(pointsOf(s.spec)).半宽));
  const text = read();
  assert.match(text, new RegExp(`${Math.floor(narrowest)}–${Math.ceil(widest)} 分`),
    `索引里的半宽应当是「${Math.floor(narrowest)}–${Math.ceil(widest)} 分」（现算），` +
    '不是别的数——这个数第一版写成 ±8，错近两倍');
});

test('索引里点名的仓库路径都真的在盘上', () => {
  const text = read();
  const mentioned = [...new Set([...text.matchAll(/`((?:docs|preset|scripts|templates)\/[\w\u4e00-\u9fff./-]+)`/g)]
    .map((m) => m[1]))];
  assert.ok(mentioned.length >= 2, `索引里只点了 ${mentioned.length} 个路径`);
  const missing = mentioned.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(missing, [], `索引点了不存在的路径：${missing.join('、')}`);
});

test('实算的三种答卷都还在（SCENARIOS 没被清空）', () => {
  assert.ok(SCENARIOS.length >= 3, 'bootstrap 脚本里的答卷场景少于 3 种，半宽就不再是从多种答卷上取的');
});

test('真判分键里的半宽数字也必须与脚本现算一致（不只是骨架）', async (t) => {
  // 骨架改过三次半宽（±8 → 14–19 → 6–19），**每一次真判分键都停在旧数字上**。
  // 骨架是模板，成品是学生真正看到的那份——模板对了、成品没跟上，等于没改。
  const { SCENARIOS, bootstrapTotal, pointsOf } = await import('../tools/closed-book-bootstrap.mjs');
  const widest = Math.ceil(Math.max(...SCENARIOS.map((s) => bootstrapTotal(pointsOf(s.spec)).半宽)));
  const narrowest = Math.floor(Math.min(...SCENARIOS.map((s) => bootstrapTotal(pointsOf(s.spec)).半宽)));

  const workspace = process.env.LEARN_WORKSPACE
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Documents', '学习', '.learning');
  const subjects = path.join(workspace, 'subjects');
  if (!fs.existsSync(subjects)) { t.skip('没有学习工作区'); return; }

  const problems = [];
  let keys = 0;
  for (const subject of fs.readdirSync(subjects, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    const dir = path.join(subjects, subject.name, 'assessments');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.includes('判分键') || !file.endsWith('.md')) continue;
      keys += 1;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of text.matchAll(/半宽\s*(\d+)[–-](\d+)\s*分/g)) {
        const [lo, hi] = [Number(match[1]), Number(match[2])];
        if (lo !== narrowest || hi !== widest) {
          problems.push(`${subject.name}/${file}：写着「半宽 ${lo}–${hi} 分」，现算是 ${narrowest}–${widest} 分`);
        }
      }
    }
  }
  if (keys === 0) { t.skip('工作区里还没有判分键'); return; }
  assert.deepEqual(problems, [], `判分键里的半宽数字与脚本对不上：\n${problems.join('\n')}`);
});