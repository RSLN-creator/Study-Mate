/* 阅读端的**取值与交互判据**（规范《阅读端呈现》§九 取值纪律、§十 交互与可调项）。
   ────────────────────────────────────────────────────────────────────────────────
   为什么单开一条套件：§九 与 §十 的末尾都写着「这几项还没有断言」——那份「未达成」的清单就是
   这里要关掉的东西。字号与行高那一半已经在 test_client_typography.mjs 里；这一条管另外几样，
   它们全都是**看起来没事**的坏法：

     · 字重自造一个 550：屏幕上几乎看不出来，但设计系统里没有这一档；
     · 圆角写成 6/7/10/14：肉眼分不出 8 与 7，改天有人问「为什么这是 7」没人答得上来；
     · 正文列的测宽上限**写死成 px**：于是拖栏宽把手时正文纹丝不动（学生报的「拖了等于没拖」）；
     · 标题忘了 sticky：滚下去再滚回来，标题被带走——这条只有真滚才知道，静态读代码看不出来；
     · 抓手静止态不可见：功能在、学生找不到（报过「没看到拖动条」）。

   判据都取「**允许集**」的写法：扫出字面值，不在集合里就红。这样新增一处自造值会当场被拦，
   而不是等下一轮有人肉眼发现。 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { extractCss, parseTokenBlock } from './fixtures/client-css.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const CSS = extractCss(fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8'));
const TOKENS = parseTokenBlock(CSS);

/** 把 CSS 拆成一条条规则（选择器、声明体、是否在 @media 里）。与 typography 那条同一种拆法。 */
function scanRules(css) {
  const out = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) walk(body, prelude);
      else out.push({ selector: prelude, body, media });
      i = j;
    }
  };
  walk(css, '');
  return out;
}

const RULES = scanRules(CSS);

/** 一条规则里某个属性的值（没有就 null）；简写属性不展开。 */
function decl(rule, prop) {
  const clean = rule.body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of clean.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === prop) return part.slice(at + 1).trim();
  }
  return null;
}

/** 某个选择器的全部声明（基础与 @media 都要，后者按「也声明过」算）。 */
function declsOf(selector) {
  return RULES.filter((rule) => rule.selector === selector).map((rule) => ({
    media: rule.media,
    get: (prop) => decl(rule, prop),
  }));
}

/** 这个选择器有没有一条规则把 `prop` 声明成匹配 `pattern` 的值。 */
function hasDecl(selector, prop, pattern) {
  return declsOf(selector).some((one) => {
    const value = one.get(prop);
    return value !== null && pattern.test(value);
  });
}

/* ── §九 A：五级标题阶梯 ─────────────────────────────────────────────────── */

test('标题阶梯是五级、且逐级递减（大标题 > 一级 > 二级 > 小标题）', () => {
  const px = (name) => {
    const one = TOKENS.get(name);
    const value = one && one.fallback;
    const hit = /^([\d.]+)px$/.exec(String(value || ''));
    return hit ? Number(hit[1]) : null;
  };
  const ladder = ['--smb-fs-h1', '--smb-fs-h2', '--smb-fs-h3', '--smb-fs-lead'];
  const values = ladder.map(px);
  assert.ok(values.every((one) => one !== null), `阶梯缺档或不是 px：${JSON.stringify(ladder.map((n, i) => [n, values[i]]))}`);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i - 1] > values[i], `第 ${i} 级没有比下一级大：${ladder[i - 1]}=${values[i - 1]}，${ladder[i]}=${values[i]}`);
  }
  // 每一级都得落在官方刻度上（11/12/13/14/16/18/20/24）
  const OFFICIAL = [11, 12, 13, 14, 16, 18, 20, 24];
  const off = ladder.filter((name, i) => !OFFICIAL.includes(values[i]));
  assert.deepEqual(off, [], `这些档不在官方刻度上：${off.map((n) => `${n}=${px(n)}`).join('、')}`);
  assert.ok(hasDecl('.smb-doc h3', 'font-size', /var\(--smb-fs-h3\)/), '二级标题（.smb-doc h3）必须引 --smb-fs-h3');
  assert.ok(hasDecl('.smb-block__title', 'font-size', /var\(--smb-fs-lead\)/), '小标题（.smb-block__title）必须引 --smb-fs-lead');
});

/* ── §九 B：字重与圆角的允许集 ───────────────────────────────────────────── */

test('字重只许 400/500/600/700', () => {
  const bad = [];
  for (const rule of RULES) {
    const value = decl(rule, 'font-weight');
    if (value === null || value === 'inherit' || value === 'bold' || value === 'normal') continue;
    if (!['400', '500', '600', '700'].includes(value)) bad.push(`${rule.selector} → ${value}`);
  }
  assert.deepEqual(bad, [], `自造字重（只能取 400/500/600/700）：\n  ${bad.join('\n  ')}`);
});

test('圆角只许官方档（4/8/12/16/20/28 与整圆）', () => {
  const ALLOWED = new Set(['0', '2', '4', '8', '12', '16', '20', '28', '99', '999', '50%', 'inherit']);
  const bad = [];
  for (const rule of RULES) {
    const value = decl(rule, 'border-radius');
    if (value === null) continue;
    for (const part of value.split(/[\s/]+/)) {
      const px = /^([\d.]+)px$/.exec(part);
      if (!px) continue;
      if (!ALLOWED.has(px[1])) bad.push(`${rule.selector} → ${value}`);
    }
  }
  assert.deepEqual(bad, [], `自造圆角（官方档是 4/8/12/16/20/28）：\n  ${bad.join('\n  ')}`);
});

/* ── §九 D / §十 B：正文列的测宽是可拖的变量，不是写死的 px ──────────────── */

test('正文列的测宽引 --smb-measure（写死 px 就是「拖了等于没拖」那个毛病）', () => {
  const values = declsOf('.smb-doc').map((one) => one.get('max-width')).filter(Boolean);
  assert.ok(values.length > 0, '.smb-doc 没有 max-width');
  const bad = values.filter((one) => !/var\(--smb-measure/.test(one));
  assert.deepEqual(bad, [], `正文列的测宽上限必须引 --smb-measure：${bad.join('、')}`);
  // 抓手住在正文列**里面**，所以正文列自己必须是一个定位基准——没有它抓手就落到滚动区上，
  // 位置只能靠 calc 去算（上一版就是这么坏的：学生报「完全拖动不了」）
  assert.ok(hasDecl('.smb-doc', 'position', /relative/), '.smb-doc 没有 position: relative（抓手没有定位基准）');
});

test('进度条占满整列：不许再有自加的测宽上限', () => {
  // 学生按截图报「这个横线你还是没有等宽」——根因是 .smb-subhead__stats 上有个 max-width: 520px。
  // 与简介那条（.smb-subhead__goal 的 68ch）是同一个毛病：没有任何要求要等宽，上限都是自己加的。
  const caps = declsOf('.smb-subhead__stats').map((one) => one.get('max-width')).filter(Boolean);
  assert.deepEqual(caps, [], `.smb-subhead__stats 不许写 max-width（进度条会只画到一半）：${caps.join('、')}`);
  const goalCaps = declsOf('.smb-subhead__goal').map((one) => one.get('max-width')).filter(Boolean);
  assert.deepEqual(goalCaps, [], `.smb-subhead__goal 不许写 max-width：${goalCaps.join('、')}`);
});

test('两条抓手都在、都能拖、静止态都看得见', () => {
  for (const selector of ['.smb-panehandle', '.smb-measurehandle']) {
    assert.ok(hasDecl(selector, 'cursor', /col-resize/), `${selector} 没有 col-resize`);
  }
  // 静止态可见：抓手那根线必须有底色与尺寸（不是 1px 的通高发丝线——学生报过「没看到」）
  for (const selector of ['.smb-panehandle > i', '.smb-measurehandle > i']) {
    assert.ok(hasDecl(selector, 'background', /var\(--smb-line-strong\)/), `${selector} 静止态没有底色`);
    const heights = declsOf(selector).map((one) => one.get('height')).filter(Boolean);
    assert.ok(heights.some((one) => /^([\d.]+)px$/.test(one) && Number(one.replace('px', '')) >= 32),
      `${selector} 静止态太短（要 ≥32px 才看得见）：${heights.join('/')}`);
  }
});

/* ── §十 A：三处滚动区的标题吸顶 ────────────────────────────────────────── */

test('左栏、右栏、以及两栏自己的小标题都吸顶（sticky）', () => {
  const STICKY = [/^sticky$/];
  assert.ok(hasDecl('.smb-left__title', 'position', STICKY[0]), '左栏小标题没有吸顶');
  assert.ok(hasDecl('.smb-subject__side .smb-block__title', 'position', STICKY[0]), '右栏（参考资料）小标题没有吸顶');
  // 主列的「目录」也要吸顶——学生按截图报过「没有固定我标出来的部分」（当时只做了右栏）
  assert.ok(hasDecl('.smb-subject__main .smb-block__title', 'position', STICKY[0]), '主列（目录）小标题没有吸顶');
  // 吸顶时背景必须不透明，否则下面的条目会从字缝里透出来
  assert.ok(hasDecl('.smb-left__title', 'background', /var\(--smb-panel\)/), '左栏吸顶标题没有不透明背景');
  assert.ok(hasDecl('.smb-subject__side .smb-block__title', 'background', /var\(--/), '右栏吸顶标题没有不透明背景');
  assert.ok(hasDecl('.smb-subject__main .smb-block__title', 'background', /var\(--/), '主列吸顶标题没有不透明背景');
});

test('按钮不拆自己的文字：压不下就整排换行，不逐字竖排', () => {
  // 学生按截图报过「参考资/料」「＋ 加一/份」「刷/新」——那是按钮作为 flex 子项被压窄的结果
  assert.ok(hasDecl('.smb-btn', 'white-space', /nowrap/), '.smb-btn 没有 white-space: nowrap');
  assert.ok(hasDecl('.smb-btn', 'flex', /none/), '.smb-btn 没有 flex: none（会跟着父级被压窄）');
});

/* ── §十 C / §十 D：小节条只显三个；科目主页两栏 ───────────────────────── */

test('小节跳转条一行不换行、可横滚（折行会把正文顶下去）', () => {
  const wraps = declsOf('.smb-secs').map((one) => one.get('flex-wrap')).filter(Boolean);
  assert.ok(wraps.length > 0, '.smb-secs 没有声明 flex-wrap');
  assert.ok(wraps.every((one) => one === 'nowrap'), `小节条不许换行：${wraps.join('/')}`);
  assert.ok(hasDecl('.smb-secs', 'overflow-x', /auto|scroll/), '小节条要能横滚');
});

test('科目主页是两栏：正文在左、参考资料在右，窄画布退回单栏', () => {
  assert.ok(hasDecl('.smb-subject', 'grid-template-columns', /1fr/), '科目主页没有两栏网格');
  const single = RULES.filter((rule) => rule.selector === '.smb-subject' && rule.media)
    .map((rule) => decl(rule, 'grid-template-columns')).filter(Boolean);
  assert.ok(single.some((one) => !/1fr\s+minmax/.test(one)), `窄画布下要退回单栏：${single.join(' / ')}`);
});
