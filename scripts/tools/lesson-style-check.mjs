#!/usr/bin/env node
/* 讲法体检：按 `lesson-design` §三 的六条判据，给一份课件做**非阻断提醒**。
 *
 * 为什么要有它：§三 的四条是「写法」判据，光写在规范里没法看出违没违。这个脚本把它变成
 * 一句句可核对的话。**它只提醒，不改文件、不阻断入库**——与内容校验器同级。
 *
 * 六条判据（出处见规范 §三）：
 *   1. 起笔：这一节第一段是不是「本节介绍……」这类概括（那是目录不是起笔）
 *   2. 回收：起笔摆出的疑问，末段有没有回收（粗判：末段有没有回指起笔的关键词）
 *   3. 篇幅：一节 > 4000 字要复核
 *   4. 并列：一节里 ≥3 个同类并列对象要拆或合并
 *   5. 符号：新符号出现的那一段还没做过具体计算时，超过 3 个要提醒
 *   6. 类比：出现「就像/好比/如同/相当于」而没有「但它/不过这里/只在这一处」这类断点声明
 *
 * 用法：node lesson-style-check.mjs <课件.md> [--json]
 */
import fs from 'node:fs';

const STOP_HEADING = /^##\s+原文在哪儿$|^##\s+三句要能说出来$/;

/** 按 `## ` 切节；`原文在哪儿` 与 `三句要能说出来` 是固定收尾，不算内容节。 */
export function sections(markdown) {
  const lines = markdown.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] };
      out.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return out
    .filter((section) => !STOP_HEADING.test(`## ${section.title}`))
    .map((section) => {
      const body = section.lines.join('\n');
      // `###` 子标题数：节里已经用三级标题把内容拆开了的证据
      const subsections = section.lines.filter((line) => line.startsWith('### ')).length;
      return {
        title: section.title,
        body,
        subsections,
        // 首段里那张总表有几行（表头与分隔行不算）
        leadTableRows: leadingTableRows(section.lines),
        // 节首（前 30 行内）有没有一张 `::: svg` / `::: figure`：图也能承担总表
        leadFigure: section.lines.slice(0, 30).some((line) => /^::: *(svg|figure)\b/.test(line)),
        chars: countProseChars(body),
        paragraphs: body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      };
    });
}

/** 节的前四段里有没有一张 ≥3 数据行的表。
 *
 * **不要求表格紧贴节首**：`0001-intro` 的「三条会让采购填错的读法」先一句
 * 「上面这些数能证伪三句流传很广的话」，然后才是那张两列表——一句话引出一张总表，
 * 是完全合规的写法，卡"紧接开头"会把它误判成没给总表。 */
function leadingTableRows(lines) {
  let blank = 0;
  let rows = 0;
  let counting = false;
  for (const line of lines) {
    if (blank > 4) break;                         // 已经过了前四段
    const isTable = /^\s*\|/.test(line);
    if (isTable) { counting = true; }
    else if (counting) { break; }                 // 这张表结束了
    else {
      if (line.trim() === '') { if (!/^\s*$/.test(line)) blank += 1; }
      if (/^\s*$/.test(line)) blank += 1;
      continue;
    }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;   // 分隔行
    rows += 1;
  }
  return Math.max(0, rows - 1);                   // 减去表头
}

function countProseChars(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .filter((line) => !/^\s*(alt|caption):/.test(line))
    .filter((line) => !/^:::/.test(line))
    .join('\n');
  return (clean.match(/[\u4e00-\u9fff]/g) || []).length;
}

/* ── 判据 1：起笔是概括还是具体 ─────────────────────────────────────── */
const GENERIC_OPENER = /^(本节|这一节|本课|这一课)(将|会|主要|只)?(介绍|讲|讨论|说明|给出|阐述)/;
const EMPTY_SCENE = /^(桌上是|手边有|设|假设|请看|先看)/;

function checkOpener(section) {
  const first = firstProseParagraph(section);
  if (!first) return null;
  if (GENERIC_OPENER.test(first)) {
    return { 判据: '起笔', 级: '提醒', 节: section.title,
      说: `起笔是概括句：「${first.slice(0, 30)}…」。那是目录不是起笔——换成摆矛盾／先给会失败的老办法／给一个做不到的处境／先给两组对不上的数。` };
  }
  return null;
}

function firstProseParagraph(section) {
  for (const paragraph of section.paragraphs) {
    if (/^:::|^```|^\||^>|^!\[/.test(paragraph)) continue;
    return paragraph.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
  }
  return '';
}

/* 回指不一定要出现「回到开头」这种字眼。实测撞到的两种合规写法：
 *   · 「范本里有三处值得留意，**它们都是前面几课挣来的**」——用「前面/上文/这些都」回指；
 *   · 「这一句**来自第 8 课**」「第 16 课补的」——把回收摊成逐条溯源。
 *
 * 两个坑（都实测踩过）：
 *   · `第一段` 单独一个词太泛——负例里就写着「第一段。」，判据当场失效。回指要说的是
 *     **回到**第一段，不是"出现了第一段"这个字。
 *   · `所以.{0,6}多` 这种宽泛的连接词会把任何一段带「所以」的收尾都算成回收。删掉。 */
const BACKREFERENCE = new RegExp([
  '回到', '回指', '本节一开始', '上面那个', '前面那个', '一开始那个',
  '回到开头', '开头那句', '开头那个', '开头摆', '开头提',
  '那个疑问', '这个问题.{0,10}(答|说|回到)',
  '这就是为什么', '前面.{0,8}(课|节|面)', '上文', '此前', '刚才.{0,6}(那|这)',
  '前面几', '它们都', '这些都', '这三处', '这两处', '这三样', '这三条', '这三件',
  '来自第', '第 ?\\d+ ?课(补|给|里)', '这是第 ?\\d+ ?课',
].join('|'));

function checkBackReference(section) {
  const first = firstProseParagraph(section);
  if (!first) return null;
  // 只对**显式提问式**起笔要求回收。一句场景描述（"桌上摆着两台机器"）不构成承诺，
  // 不回收不算问题——把场景也纳进来会让这条判据在几乎每一节上都报。
  if (!/[？?]/.test(first)) return null;
  // **看全节，不只末段**：`0006-material-abx3` 的「容差因子当判据」在第 2 段就把
  // "t 落在 0.7–1.1" 答了，末段接的是练习说明——只查末段会把它误判成没回收。
  const rest = section.paragraphs.slice(section.paragraphs.indexOf(first) + 1).join('\n');
  if (BACKREFERENCE.test(rest)) return null;
  // 降级为**提示**：这条判据只看"有没有一句话把视线拉回去"，判不出"答得对不对"，
  // 信号弱，不该和符号、类比那几条同级。
  return { 判据: '回收', 级: '提示', 节: section.title,
    说: '起笔用了提问式，但全节没有一处把视线拉回去（"回到开头/上文/来自第几课"这类）。不是每个提问都要回收，但若这个提问是为下文立的靶子，就该有一句话把它收掉。' };
}

function lastProseParagraph(section) {
  for (let i = section.paragraphs.length - 1; i >= 0; i -= 1) {
    const paragraph = section.paragraphs[i];
    if (/^:::|^```|^\||^>/.test(paragraph)) continue;
    return paragraph;
  }
  return '';
}

/* ── 判据 3 / 4：篇幅与并列 ─────────────────────────────────────────── */
const ENUMERATION_HEADING = /五段|四条|三类|五种|四类|六类|三条|两条|四种|三种/;

function checkLength(section) {
  if (section.chars <= 4000) return null;
  return { 判据: '篇幅', 级: '提醒', 节: section.title,
    说: `这一节 ${section.chars} 字，超过 4000 的复核线（本科目 p90 = 3626）。问一句：这一节是不是该拆。` };
}

function checkEnumeration(section) {
  // **只看标题，不数表格列**：一张 6 列的对照表是好事不是缺陷，把它算成"并列罗列"会让
  // 这条判据在几乎每一节上都报一次，真正该看的那几节反而被淹没。
  //
  // 两种已经算"拆开"的写法，都不报：
  //  · `###` 子标题把每个对象分开（`0010-talk-ready` 的「五段各自要说什么」）；
  //  · 节首一张**多行**总表把每个对象收在一起（`0001-intro` 的「三条会让采购填错的读法」
  //    就是两列表三行——那正是规范里说的"节首给一张总表"）。
  if (!ENUMERATION_HEADING.test(section.title)) return null;
  if (section.subsections >= 3) return null;
  if (section.leadTableRows >= 3) return null;
  // **一张把每个对象收住的图也算总表**：`0016-stability` 的「三条通道一张表」用的是一张
  // 三行链条图（每行一条通道：驱动量 → 中间过程 → 现象），节内再逐条展开差异。
  // 那正是规范要的写法，只是载体是 `::: svg` 而不是管道表。
  if (section.leadFigure) return null;
  return { 判据: '并列', 级: '提示', 节: section.title,
    说: '标题就是"N 个东西并列"，而节内既没拆成子节、也没有一张把每个对象收住的总表。要么拆成 N 节，要么节首给一张总表、节内每个对象只写"与总表不同的那一点"。' };
}

/* ── 判据 5：一段里新符号太多且没有具体计算 ─────────────────────────── */
/* 只认**单字母或带下标的短符号**（f、D、w、p、N、n、W、HFOV、f_px）。
 *
 * 两个坑，都实测踩过：
 *  1. **LaTeX 命令不是符号**：`\frac`、`\cdot`、`\arctan` 是排版指令。不排除它们，
 *     每一段有公式的正文都会超限，判据就废了。
 *  2. **下标里的文字不是独立符号**：`k_{\text{B}}` 是一个符号（玻尔兹曼常数），
 *     `L_{\text{d}}` 是一个符号（扩散长度）。第一版按 `[A-Za-z]+` 逐个抽词，把
 *     `k_{\text{B}}T` 数成了 k、B、T 三个，一段的符号数虚增近一倍——真该报的节
 *     反而因为"数太大"显得不可信。所以先把 `_{…}` 整块摘掉再抽。 */
const LATEX_COMMAND = /^\\(?:frac|cdot|arctan|tan|sqrt|mathrm|text|times|div|approx|le|ge|neq|left|right|qquad|quad|Delta|mu|varepsilon|theta|omega|lambda|pi|tau|ast|star|circ|pm|mp|sim|simeq|propto|infty|partial|nabla|sum|int|prod|to|rightarrow|Rightarrow|ldots|dots|alpha|beta|gamma|delta|kappa|rho|sigma|phi|chi|psi|eta|nu|xi|zeta|iota|upsilon)$/;
const SYMBOL_TOKEN = /^[A-Za-z](?:_[A-Za-z0-9]+)?$|^[A-Z]{2,6}(?:_[A-Za-z0-9]+)?$/;
/* **代码常量名不算数学符号**：`f_mm`、`FACE_W`、`PIXEL_UM`、`REQ_FACE_PX` 是学生脚本里的
 * 变量，读者不需要"交代口径"，它们就写在代码里。实测踩过：`0002-face-px-threshold` 的
 * 「改一个输入反推门槛与焦距」因为列了七个输入常量被报"进了六个符号"。判据只抓数学符号。 */
const CODE_CONSTANT = /^(?:[a-z]+(?:_[a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;

/** 把 `_{…}`（可能嵌套）整块去掉，并记下它属于哪个主符号。 */
function stripSubscripts(text) {
  const names = [];
  let depth = 0;
  let out = '';
  let buffer = '';
  for (const ch of text) {
    if (ch === '{' && depth === 0 && out.endsWith('_')) { depth = 1; buffer = ''; continue; }
    if (depth > 0) {
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { names.push(buffer); } }
      else buffer += ch;
      continue;
    }
    out += ch;
  }
  return { text: out, subscripts: names };
}

function countSymbols(paragraph) {
  const found = new Set();
  for (const match of paragraph.matchAll(/`([A-Za-z_][\w.]*)`/g)) {
    if (!SYMBOL_TOKEN.test(match[1])) continue;
    if (CODE_CONSTANT.test(match[1])) continue;          // f_mm / FACE_W 是代码变量
    found.add(match[1]);
  }
  for (const match of paragraph.matchAll(/\$([^$\n]{1,80})\$/g)) {
    const { text } = stripSubscripts(match[1]);
    for (const token of text.matchAll(/\\[A-Za-z]+|[A-Za-z]+/g)) {
      const word = token[0];
      if (word.startsWith('\\')) {
        if (LATEX_COMMAND.test(word)) continue;
        found.add(word);
        continue;
      }
      if (SYMBOL_TOKEN.test(word)) found.add(word);
    }
  }
  return found;
}

function checkSymbolFlood(section, alreadySeen = new Set()) {
  const issues = [];
  let calculated = false;
  const seen = new Set(alreadySeen);
  for (const paragraph of section.paragraphs) {
    // "做过具体计算"：出现等号且右边是数字，或两个数之间出现了乘除
    if (/=\s*-?[\d.]/.test(paragraph) || /[\d.]\s*[×÷*/]\s*[\d.]/.test(paragraph)) calculated = true;
    const symbols = [...countSymbols(paragraph)];
    // **只数全文首次出现**：同一个符号在 §2 交代、在 §7 的练习卡里再用，那不是"新进"。
    // 判据的原话是「新符号出现的那一段」，不是「这一段里出现了几个符号」。
    const fresh = symbols.filter((symbol) => !seen.has(symbol));
    for (const symbol of symbols) seen.add(symbol);
    if (calculated || fresh.length <= 3) continue;
    // **每个符号都当场带了单位**（A/W、%、Jones、nm），等于逐个交代过了口径——这也算合规。
    // `0012-exp-1` 的「三栏各装什么」正是这么写的：R 跟 A/W、EQE 跟 %、D* 跟 Jones。
    if (fresh.every((symbol) => hasUnitRightAfter(paragraph, symbol))) continue;
    issues.push({ 判据: '符号', 级: '提醒', 节: section.title,
      说: `还没做过一次具体计算，这一段就进了 ${fresh.length} 个首次出现的符号（${fresh.slice(0, 6).join('、')}…）。一次别进太多——先给一个能算出数的例子，或者像「含义 / 单位 / 取值」那样先摆一张表，把符号挂上去。` });
    break;
  }
  return issues;
}

const UNIT_TOKENS = /(A\/W|mA\/W|Jones|Jones|%|nm|μm|mm|cm|m|s|ms|μs|ns|V|mV|kV|A|mA|nA|μA|W|mW|μW|Hz|kHz|MHz|GHz|K|℃|eV|J|F|Ω|C|px|dB)/;

/** 这个符号在段内出现的位置附近（同一句或紧跟的分句里）有没有单位。 */
function hasUnitRightAfter(paragraph, symbol) {
  const at = paragraph.indexOf(symbol);
  if (at < 0) return false;
  const window = paragraph.slice(at, at + 120);
  const sentence = window.split(/[。；]/)[0];
  return UNIT_TOKENS.test(sentence);
}

/** 全文档级别的符号出现顺序：第几段第一次见到这个符号。 */
function symbolFirstSeen(markdown) {
  const order = new Map();
  let index = 0;
  for (const section of sections(markdown)) {
    for (const paragraph of section.paragraphs) {
      for (const symbol of countSymbols(paragraph)) {
        if (!order.has(symbol)) order.set(symbol, index);
      }
      index += 1;
    }
  }
  return order;
}

/* ── 判据 6：类比没有断点声明 ────────────────────────────────────────── */
const ANALOGY = /(就像|好比|如同|相当于|类似于|像是|打个比方|可以想成)/;
const ANALOGY_BREAK = /(但它|不过这里|只在这|到这里就|不能推广|只在[^。]{0,10}成立|类比到此|断在|不准|不成立|不等于|不能推出|别把它当|只解释)/;
/* 「相当于」有两种用法，只有一种算类比：
 *  · **数值换算**：「1.8 kN，相当于 180 kg 的重物压着它」——两边都是量，不涉及结构映射，
 *    不可能产生 misconception（实测踩过：`0008-paper1-hotpress` 这条被误报）；
 *  · **结构性类比**：「作用相当于给一个相发的身份证号」——把 A 的关系映射到 B。
 * 判据只抓后者：`相当于` 前面 14 字里出现"数字 + 单位"的，当换算跳过。 */
const NUMERIC_EQUIVALENCE = /\d[\d.]*\s*(?:kN|N|kg|g|mg|MPa|Pa|mm|cm|m|μm|nm|Å|kV|V|mV|mA|A|μA|nA|s|ms|μs|ns|℃|°C|%|K|eV|Hz|kHz|MHz|GHz|W|mW|μW|J|mJ|L|mL|min|h)\s*[，,]?\s*$/;

function isNumericEquivalence(text, at) {
  const before = text.slice(Math.max(0, at - 20), at);
  return NUMERIC_EQUIVALENCE.test(before);
}

function checkAnalogy(section) {
  const issues = [];
  for (const paragraph of section.paragraphs) {
    const match = ANALOGY.exec(paragraph);
    if (!match) continue;
    if (match[0] === '相当于' && isNumericEquivalence(paragraph, match.index)) continue;
    // 断点声明可以出现在同段，也可以出现在紧接着的下一段
    const at = section.paragraphs.indexOf(paragraph);
    const window = [paragraph, section.paragraphs[at + 1] || ''].join('\n');
    if (ANALOGY_BREAK.test(window)) continue;
    issues.push({ 判据: '类比', 级: '提醒', 节: section.title,
      说: `出现类比（${match[0]}）但紧跟的一两段里没有"它在哪儿断掉"的声明。没有断点声明的类比是已知会制造误解的做法（PRPER 10.1103/ch6t-qvz6）。` });
    break;
  }
  return issues;
}

/* ── 汇总 ───────────────────────────────────────────────────────────── */

export function inspect(markdown) {
  const found = [];
  const firstSeen = symbolFirstSeen(markdown);
  const seen = new Set();
  for (const section of sections(markdown)) {
    for (const check of [checkOpener, checkBackReference, checkLength, checkEnumeration, checkSymbolFlood, checkAnalogy]) {
      if (check === checkSymbolFlood) continue;
      const result = check(section);
      if (!result) continue;
      if (Array.isArray(result)) found.push(...result);
      else found.push(result);
    }
    // 符号判据要带着「到这里为止已经见过哪些符号」进去
    const result = checkSymbolFlood(section, seen);
    found.push(...result);
    for (const paragraph of section.paragraphs) {
      for (const symbol of countSymbols(paragraph)) seen.add(symbol);
    }
  }
  void firstSeen;
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('lesson-style-check.mjs')) {
  const target = process.argv[2];
  if (!target) { console.error('用法：node lesson-style-check.mjs <课件.md> [--json]'); process.exit(2); }
  const found = inspect(fs.readFileSync(target, 'utf8'));
  if (process.argv.includes('--json')) console.log(JSON.stringify(found, null, 2));
  else if (found.length === 0) console.log('讲法体检：没有提醒。');
  else {
    console.log(`讲法体检：${found.length} 条提醒（非阻断）\n`);
    for (const item of found) console.log(`[${item.级}] ${item.判据} · ${item.节}\n    ${item.说}\n`);
  }
}
