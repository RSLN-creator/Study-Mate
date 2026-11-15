/* 检验记录骨架：报分必须带的东西，一件都不许省。
   ────────────────────────────────────────────────────────────────────────
   为什么要有这一条：报分的规矩散在 `layered-practice` 的七八处——带区间、带三条局限、
   判定带只是报告用语、剖面比总分稳、拿不准的题要写出来。**没有一份成品把它们一次落全。**

   学生答完题，最可能发生的事是：评分者只报一个总分。那个总分会被当成判决用，
   而它的半宽是 6–19 分。

   判据四条：
   ① 骨架的「三条必填局限」一节在，且三条都在；
   ② 「判定带是报告用语，不是判决」这句在；
   ③ 「拿不准的题不许空着」在——空着比判错一题更糟；
   ④ 「判分键什么时候打开的」这一行在。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECORD = path.join(ROOT, 'templates/closed-book/检验记录.md');
const read = () => fs.readFileSync(RECORD, 'utf8').replaceAll('\r\n', '\n');

test('检验记录骨架在手', () => {
  assert.ok(fs.existsSync(RECORD), '检验记录骨架不在——报分就只剩一个总分');
});

test('三条必填局限逐条都在，且明说一条不许省', () => {
  const text = read();
  assert.match(text, /三条必填局限/, '要有「三条必填局限」这一节');
  assert.match(text, /一条都不许省/, '要写明一条都不许省');
  // 三条各自的实质
  assert.match(text, /一次性施测/, '第一条：一次性施测、没有重测');
  assert.match(text, /半宽/, '第二条：半宽很大');
  assert.match(text, /可能漏掉了有价值但没出题的部分/, '第三条：产物可能漏掉了有价值的部分');
});

test('「判定带是报告用语，不是判决」这句在，且给出了写法示例', () => {
  const text = read();
  assert.match(text, /报告用语，不是判决/, '要明说判定带只是报告用语');
  assert.match(text, /写「落在『部分通过』一带」/, '要给出正确写法');
  assert.match(text, /不要写「没通过」/, '要给出错误写法');
});

test('「拿不准的题不许空着」在，且说清了为什么', () => {
  const text = read();
  assert.match(text, /不许空着/, '要写明这一栏不许空着');
  assert.match(text, /空着这一栏比判错一题更糟/, '要说清为什么——否则读的人会随手空着');
});

test('「判分键什么时候打开的」这一行在', () => {
  const text = read();
  assert.match(text, /判分键是什么时候打开的|判分键.{0,4}什么时候打开/, '这一行是报分单唯一能自查的诚实点，不许省');
  assert.match(text, /收到答卷之后/, '要给出正常选项');
  assert.match(text, /不算/, '要写明「之前打开」时分数作废');
});

test('反证：缺任何一条，这条判据都要报出来', () => {
  // 用一个删掉关键句的副本验证判据不空转。
  const full = read();
  const broken = full
    .replace(/一条都不许省/g, '')
    .replace(/报告用语，不是判决/g, '')
    .replace(/不许空着/g, '');
  const checks = [
    [/一条都不许省/, broken],
    [/报告用语，不是判决/, broken],
    [/不许空着/, broken],
  ];
  for (const [pattern, text] of checks) {
    assert.equal(pattern.test(text), false, `删掉之后「${pattern}」不该还能匹配到——判据得有牙`);
  }
});
