/* 闭卷卷子与判分键的骨架守卫。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：`templates/closed-book/` 的两份骨架是「出题角色照抄」的东西，抄错一处
   就产出一份不可比的量具。而这份量具的三条硬规矩（两份分开、同时写、只看产物判）全在文字里，
   没有任何自动检查会红——除非这里钉住。

   钉的是**结构**，不是措辞：五个部分的名字与配分、两条判定线、三条局限、以及「不许打开」的
   那条警告。措辞可以改，这些东西改了就等于换了一把尺子。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(ROOT, 'templates', 'closed-book');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replaceAll('\r\n', '\n');

test('两份骨架都在，且判分键的名字里带「判分键」', () => {
  const entries = fs.readdirSync(DIR).sort();
  assert.ok(entries.includes('卷子.md'), '卷子骨架要在');
  assert.ok(entries.includes('判分键.md'), '判分键骨架要在——名字里必须带「判分键」，那是在说"别先打开我"');
  assert.ok(entries.includes('README.md'), '两份骨架的用法说明要在');
});

test('判分键开头有「评卷前不要打开」与「收到答卷之后才打开」两句', () => {
  const key = read('判分键.md');
  assert.match(key, /在评卷前不要打开/, '判分键必须自带那句警告');
  assert.match(key, /收到答卷之后才打开/, '评分记录要写明这一点，骨架得先把它说出来');
});

test('五个部分的名字与配分逐字一致（配分是量具的一部分，改了就不可比）', () => {
  const expected = [
    ['一、骨架（20 分）', 20],
    ['二、因果（35 分）', 35],
    ['三、数值（20 分）', 20],
    ['四、迁移（15 分）', 15],
    ['五、元认知（10 分）', 10],
  ];
  for (const name of ['卷子.md', '判分键.md']) {
    const text = read(name);
    let sum = 0;
    for (const [heading, points] of expected) {
      assert.ok(text.includes(`## ${heading}`), `${name} 缺「## ${heading}」`);
      sum += points;
    }
    assert.equal(sum, 100, '五部分配分要凑满 100');
  }
});

test('两条判定线都在：总分 75 且迁移 9 才是通过；60–75 是「部分通过」', () => {
  const key = read('判分键.md');
  assert.match(key, /总分 ≥ 75/);
  assert.match(key, /第四部分 ≥ 9|迁移 ≥9|迁移不足 9/);
  assert.match(key, /部分通过/, '「记住了但不会用」这个中间态必须报出来，不能合并进通过或不通过');
});

test('计分总则里写了「只看产物、不看自评」与「±2% 算命中」', () => {
  const key = read('判分键.md');
  assert.match(key, /只看写出来的内容判/, '这是 2026-11-15 两个评分者分岔的那一条，必须写死');
  assert.match(key, /不看答题者什么时候记住的/);
  assert.match(key, /±2%/, '数值容差要写死，否则不同批次不可比');
});

test('三条局限都在：一次性施测、±8 分半宽、可能漏掉有价值的部分', () => {
  const key = read('判分键.md');
  assert.match(key, /一次性施测/, '分不出「这次没想起来」与「本来就没学会」');
  assert.match(key, /±8 分/, '分数区间半宽要报出来');
  assert.match(key, /可能漏掉/, '卷子按课件出，可能漏掉课里有价值但没出题的部分');
});

test('README 写清三条硬规矩与「模型不代答」', () => {
  const readme = read('README.md');
  assert.match(readme, /两份必须分开/, '第一条硬规矩');
  assert.match(readme, /两份必须同时写/, '第二条硬规矩');
  assert.match(readme, /只看写出来的内容判/, '第三条硬规矩');
  assert.match(readme, /模型不代答/, '被试必须是人——这条没有例外');
});

test('lab 骨架没被这一份影响（两套骨架互不污染）', () => {
  const lab = path.join(ROOT, 'templates', 'lab');
  assert.ok(fs.existsSync(path.join(lab, '0000-示例', 'check.sh')), 'lab 骨架的判分入口还在');
  assert.ok(!fs.existsSync(path.join(DIR, 'check.sh')), '闭卷骨架不该有判分入口——它不是 lab');
});
