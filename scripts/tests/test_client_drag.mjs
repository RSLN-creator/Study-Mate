/* 阅读端三条**运行时行为**的源码形状断言（规范《阅读端呈现》§十 B 的尾巴）。
   ────────────────────────────────────────────────────────────────────────────────
   **先说清这条套件验到哪一层，别把它当行为测试读**：

     §十 B 要的三条——**跟手**（逐帧派发，不滞后不滞留）、**双击复位**、**持久化**——都是指针
     事件驱动的运行时行为。真的验它们要么真浏览器，要么一套假的 `requestAnimationFrame` ＋ 合成
     pointer 事件的渲染沙箱。这一条**两样都不是**：它只读 `lib/client.js` 的源码，断言那三个
     机制**还在**（没被哪次重构顺手删掉）。所以它拦得住「删了 `requestAnimationFrame` 合并」，
     **拦不住**「合并写错了」——后者仍然需要真浏览器（学生自己看）。

   为什么还是值得写：这三条曾经全是「只有实现、没有断言」，而它们的坏法恰恰都是**静默**的——
   去掉 rAF 合并，拖动仍然能改宽度（只是变卡），截图与套件都看不出来。形状断言是这一层里
   唯一不花浏览器就能加的那道闸。 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');

/**
 * 抠出 `function 名字(` 到下一个同级 `function`（或文件尾）之间的那段源码。
 * 用「下一个 `\n    function `」当边界：这个文件里组件都定义在同一层缩进上。
 */
function bodyOf(name) {
  const head = 'function ' + name + '(';
  const at = SOURCE.indexOf(head);
  assert.ok(at >= 0, `lib/client.js 里找不到 ${name}（改名了？）`);
  const rest = SOURCE.slice(at + head.length);
  const stop = rest.indexOf('\n    function ');
  return stop < 0 ? rest : rest.slice(0, stop);
}

test('两条把手都做了 rAF 逐帧合并（跟手），且收手前补最后一帧', () => {
  for (const name of ['PaneHandle', 'MeasureHandle']) {
    const body = bodyOf(name);
    assert.ok(/requestAnimationFrame/.test(body),
      `${name} 里没有 requestAnimationFrame——直接在 pointermove 里改布局，拖动会滞后（规范 §十 B「跟手」）`);
    assert.ok(/frame\s*=\s*schedule\(/.test(body) || /frame\s*=\s*\(typeof requestAnimationFrame/.test(body),
      `${name} 没有「一帧只派发一次」的那道闸（frame 变量）`);
    // 收手前把最后一帧补上，否则停在半路的位置会被丢掉（拖到哪就停在哪）
    assert.ok(/const up = \(\) => \{[\s\S]{0,200}?flush\(\)|const up = \(\) => \{[\s\S]{0,200}?apply\(\)/.test(body),
      `${name} 的 pointerup 没有补最后一帧——松手时最后那点位移会丢`);
  }
});

test('两条把手都能双击复位，且都有从默认值起拖的起点', () => {
  const pane = bodyOf('PaneHandle');
  assert.ok(/onDoubleClick:\s*onReset/.test(pane), 'PaneHandle 丢了双击复位');
  const measure = bodyOf('MeasureHandle');
  assert.ok(/onDoubleClick/.test(measure), 'MeasureHandle 丢了双击复位');
  assert.ok(/measure\.reset\(\)/.test(measure), 'MeasureHandle 的双击没有调 reset（复位不了）');
});

test('宽度偏好落本地：正文档与栏宽各有一个键', () => {
  assert.ok(/studymate\.measure\.v1/.test(SOURCE), '正文档位宽的本地键没了（刷新就丢宽度）');
  assert.ok(/studymate\.panes\.v1/.test(SOURCE), '左右栏宽的本地键没了（刷新就丢栏宽）');
  const hook = bodyOf('useMeasureWidth');
  assert.ok(/localStorage\.getItem\(MEASURE_KEY\)/.test(hook), 'useMeasureWidth 没有读本地偏好');
  assert.ok(/setProperty\('--smb-measure'/.test(hook), 'useMeasureWidth 没有把值写到 --smb-measure 上');
});

test('测宽抓手住在正文列**里面**（定位基准是 .smb-doc 自己，不靠算）', () => {
  // 上一版把它挂在滚动区上，位置用 right: max(0px, calc((100% - min(100%, var(--smb-measure))) / 2 - 4px))
  // 算出来——calc 里嵌 min、百分比与 em 混算，学生报「完全拖动不了」。能靠 DOM 关系表达的不要靠算。
  const docAt = SOURCE.indexOf("h('article.smb-doc', null,");
  const handleAt = SOURCE.indexOf('h(MeasureHandle, { measure })');
  assert.ok(docAt >= 0, 'lib/client.js 里找不到 article.smb-doc 的渲染');
  assert.ok(handleAt > docAt, '抓手要渲染在 article.smb-doc **里面**（在外层就失去定位基准，只能靠算）');
  // 而且不许再用「画布宽减列宽折半」那种算法（那是上一版坏掉的原因）。
  // ⚠ 判之前必须**剔掉注释**：注释里正写着那串被废弃的算法当反例，不剔就会匹配到自己
  // （同一条套件在 `.smb-subhead__stats` 的 max-width 上也踩过一次这种误伤）。
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/right:\s*max\(0px,\s*calc\(/.test(CODE),
    '不该再用 max(0px, calc(...)) 去算抓手的位置——它在滚动容器上没能落到位');
});

test('居中列拖 d 只挪 d/2，所以测宽必须加 2d（否则跟不住手）', () => {
  const measure = bodyOf('MeasureHandle');
  assert.ok(/2\s*\*\s*\(pendingX\s*-\s*origin\.current\.x\)/.test(measure),
    'MeasureHandle 的位移没有乘 2——正文档是居中列，右边缘只挪一半，乘 1 会让抓手跑在手后面');
});

test('两条把手都有可拖的真实热区与键盘可达性', () => {
  for (const name of ['PaneHandle', 'MeasureHandle']) {
    const body = bodyOf(name);
    assert.ok(/role:\s*'separator'/.test(body), `${name} 没有 separator 角色（读屏用户拖不到）`);
    assert.ok(/tabIndex:\s*0/.test(body), `${name} 键盘到不了`);
  }
});
