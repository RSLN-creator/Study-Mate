#!/usr/bin/env node
/* 课件正文可理解性测量（纯 Node，无第三方依赖）。
 *
 * 只测「正文散文」：YAML frontmatter、代码围栏、::: svg / ::: figure 块里的内容不进统计。
 *
 * 输出每个课件的 9 个指标与一个合成分 U（0–100，越高越好读）。
 * 指标定义与阈值的出处见 docs/设计/学习方法层.md；
 * 权重是工程约定，不是文献值——validate.mjs 用仓库自己的「禁写清单」正负样例验它有没有分辨力。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ── 文本切分 ─────────────────────────────────────────────────────────── */

/** 去掉 frontmatter 与所有非散文块，返回纯散文行。 */
export function proseLines(markdown) {
  const lines = markdown.replace(/^\ufeff/, '').split(/\r?\n/);
  const out = [];
  let i = 0;
  if (lines[0] === '---') {                       // YAML frontmatter
    i = 1;
    while (i < lines.length && lines[i] !== '---') i += 1;
    i += 1;
  }
  let fence = null;                                // ```lang
  let block = null;                                // ::: svg / figure / code / term
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceOpen = /^\s*```(\w*)/.exec(line);
    if (fence === null && fenceOpen) { fence = fenceOpen[1] || 'none'; continue; }
    if (fence !== null) { if (/^\s*```/.test(line)) fence = null; continue; }

    const blockOpen = /^::: *(svg|figure|code|term)\b/.exec(line);
    if (block === null && blockOpen) { block = blockOpen[1]; continue; }
    if (block !== null) { if (/^:::\s*$/.test(line)) block = null; continue; }

    out.push(line);
  }
  return out;
}

/** 表格行与图块字段（alt:/caption:）本来就不是散文，在切句之前就丢掉。 */
export function stripNonProse(proseText) {
  return proseText
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|/.test(line))                        // 表格行
    .filter((line) => !/^\s*(alt|caption|来源|许可):/.test(line))   // 图块字段
    .filter((line) => !/^:::/.test(line))
    .join('\n');
}

/** 段落 → 句子。按 。！？； 与换行切，丢弃列表符号与标题井号。 */
export function sentences(proseText) {
  const text = stripNonProse(proseText)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^\s*[-*]\s+/, ''))
    .join('\n');
  return text
    .split(/[。！？；\n]+/)
    .map((s) => s.replace(/[\s　]+/g, ''))
    .filter((s) => s.length >= 6 && /[\u4e00-\u9fff]/.test(s));
}

/* ── 连接词与路标 ─────────────────────────────────────────────────────── */

const CONNECTIVES = [
  '因为', '所以', '因此', '于是', '由于', '导致', '使得', '从而', '因而',
  '如果', '若', '假设', '只要', '除非', '否则', '就', '则',
  '但', '然而', '不过', '相反', '而', '却',
  '也就是', '即', '换句话说', '具体来说', '例如', '比如', '例如说',
  '因此可见', '由此', '这说明', '这意味着', '结果是',
];
const SIGNPOSTS = [
  '首先', '其次', '再次', '最后', '第一', '第二', '第三', '第四',
  '本节', '这一节', '下面', '上面', '接下来', '综上', '总结一下',
  '本节先', '回到', '先看', '再看', '三件事', '两件事',
];

/** 句首是否带衔接词（用来判定「这一句和上一句之间有没有桥」）。 */
function startsWithConnective(sentence) {
  return CONNECTIVES.some((word) => sentence.startsWith(word));
}

/* ── 指标 1：连贯空缺（inference gap） ─────────────────────────────────
 * 判据：相邻两句几乎不共享实词，且后一句里没有任何衔接成分 → 读者得自己补一步推理。
 * 出处：Britton & Gülgöz 1991（1000 词标出 40 处需推理位置，逐一补桥后自由回忆大幅提升；**二手，
 * 未读原文**）；**Leroy et al. 2013（已读摘要）：连贯性增强让选择题成绩显著变好，p=.003**——
 * 这条是同一个指标的直接支持，而且是唯一我们自己核过原文的一条（见 docs/取证/学习方法-文献.md）。
 *
 * 为什么用**单字重叠**而不是二元组 Jaccard：中文意合，二元组在真实课件上饱和
 * （实测 23 份全落在 38±3/千字，等于没分辨力）。单字重叠的分布是 31–60%，
 * 且在仓库自己的正负样例上 57% vs 0% 完全分开（validate.mjs 有对照）。 */
const FUNCTION_CHARS = new Set('的了是在和与或就也还很更最不没有这那一个些以对为把被从到着过们所之其'.split(''));

function contentChars(sentence) {
  const set = new Set();
  for (const ch of sentence.replace(/[^\u4e00-\u9fff]/g, '')) {
    if (!FUNCTION_CHARS.has(ch)) set.add(ch);
  }
  return set;
}

/** 两句的实词重叠度：交集 ÷ 较短那句的字数（较长那句不该拉低相似度）。 */
function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const ch of b) if (a.has(ch)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/* ── 指标 2：拟物动词（无生命主语 + 只该接有生命主语的动词） ─────────────
 * 判据来自 lesson-design 禁写清单第 10 条（出处 Clark et al. 2026）。
 * 检测：无生命主语（这/该/此/本/它 + 生命度低的名词）在 12 字内接黑名单动词。 */
const INANIMATE_NOUN = /(函数|方法|算法|模块|模型|系统|程序|代码|接口|进程|线程|曲线|数据|参数|指标|方案|门槛|表格|图表|画面|视频|网络|协议|像素|信号|缓存|队列|栈|堆|文件|目录|字段|指令|镜头|相机|传感器|靶面|视场|结构|流程|机制|规则|规范|标准|策略|配置|日志|索引|容器|算子|损失|梯度|权重|误差|余量|预算)/;

/* 只收「人类语料里几乎只接有生主语」的动词。
 * 「决定 / 选择 / 认为 / 知道 / 影响 / 支持 / 需要」这类中文里对无生物主语完全正常
 * （「误差由比值决定」「标准支持这种做法」），收进来只会制造误报——实测它们占全部
 * 命中里的绝大多数。这一条宁漏不错：漏了由人工复核补，错了会让整份课件被误判。 */
const ANIMATE_VERBS = [
  '吞掉', '吞下', '吃掉', '吃光', '咬住', '咬掉', '挤出', '抢走',
  '记住', '忘掉', '学会', '盯住', '盯着', '追丢',
  '拒绝', '愿意', '想要', '以为', '觉得', '尝试', '努力', '撑爆',
  '喂给', '扛不住',
];

function animacyViolations(sentencesList) {
  const hits = [];
  for (const sentence of sentencesList) {
    for (const verb of ANIMATE_VERBS) {
      let from = 0;
      for (;;) {
        const at = sentence.indexOf(verb, from);
        if (at < 0) break;
        const window = sentence.slice(Math.max(0, at - 14), at);
        if (INANIMATE_NOUN.test(window)) hits.push({ sentence, verb, at });
        from = at + verb.length;
      }
    }
  }
  return hits;
}

/* ── 指标 3：定语嵌套（stacked attributives 的中文代理） ──────────────────
 * lesson-design 第 12 条要的是「三个及以上名词连缀」。中文里名词连缀几乎总靠「的」
 * 串起来（「基于深度学习的多尺度特征融合的人脸检测方法」），所以这里直接数
 * **一个分句里「的」出现几次**：≥3 次判为嵌套过深。
 *
 * 为什么不用「连续汉字 ≥8 字」那条：实测在真实课件上误报率极高（「下面给出采样精度
 * 余量分配方案」把「给出」也吞进去了），且几乎不触发，等于没测。数「的」既可算、
 * 又在仓库自己的错误样例上分得开——validate.mjs 里有对照。 */
const CLAUSE_BREAK = /[，。！？；：、\n]/;

function deepAttributives(sentencesList) {
  const hits = [];
  for (const sentence of sentencesList) {
    for (const clause of sentence.split(CLAUSE_BREAK)) {
      const count = (clause.match(/的/g) || []).length;
      if (count >= 3) hits.push({ clause: clause.trim(), count });
    }
  }
  return hits;
}

/* ── 指标 4：就近整合（split attention） ────────────────────────────────
 * 每个 ::: figure / ::: svg / ::: code 块，在正文里第一个指代它的句子
 * （提到「图」「表」「式子」「代码」「上式」「下图」）与块之间隔了多少字。 */
function splitAttention(markdown) {
  const lines = markdown.replace(/^\ufeff/, '').split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) if (/^::: *(figure|svg|code)\b/.test(lines[i])) blocks.push(i);
  const prose = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim() && !/^\s*[|:#`]/.test(line));
  const results = [];
  for (const at of blocks) {
    let best = null;
    for (const item of prose) {
      if (Math.abs(item.index - at) < 2) continue;
      if (!/(这张|那张|下图|上图|本图|图中|如表|表里|下表|上式|下式|这条式子|这段代码|这段|图注)/.test(item.line)) continue;
      const distance = Math.abs(item.index - at) * 40;   // 行数 → 粗估字符数
      if (best === null || distance < best) best = distance;
    }
    results.push({ line: at + 1, distance: best });
  }
  return results;
}

/* ── 单文件测量 ───────────────────────────────────────────────────────── */

export function analyze(markdown) {
  const prose = stripNonProse(proseLines(markdown).join('\n'));
  const sents = sentences(prose);
  const chars = (prose.match(/[\u4e00-\u9fff]/g) || []).length || 1;
  const per1k = (count) => (count / chars) * 1000;

  // 1 连贯空缺
  const charSets = sents.map(contentChars);
  let gaps = 0;
  for (let i = 1; i < sents.length; i += 1) {
    if (CONNECTIVES.some((word) => sents[i].includes(word))) continue;
    if (overlap(charSets[i - 1], charSets[i]) < 0.2) gaps += 1;
  }

  // 2 拟物动词
  const animacy = animacyViolations(sents);

  // 3 长定语连缀
  const attrib = deepAttributives(sents);

  // 4 就近整合
  const split = splitAttention(markdown);
  const splitBad = split.filter((item) => item.distance !== null && item.distance > 200).length;

  // 5 句长
  const lens = sents.map((s) => s.length).sort((a, b) => a - b);
  const at = (q) => lens[Math.min(lens.length - 1, Math.floor(lens.length * q))] || 0;
  const over60 = lens.filter((n) => n > 60).length;

  // 6 「的」密度（定语层级代理）
  const deCount = sents.reduce((sum, s) => sum + (s.match(/的/g) || []).length, 0);

  // 7 路标
  const signposts = sents.filter((s) => SIGNPOSTS.some((word) => s.includes(word))).length;

  // 8 衔接词
  const connectives = sents.filter((s) => CONNECTIVES.some((word) => s.includes(word))).length;

  return {
    句数: sents.length,
    汉字数: chars,
    平均句长: Number((lens.reduce((a, b) => a + b, 0) / (lens.length || 1)).toFixed(1)),
    句长P90: at(0.9),
    超60字占比: Number(((over60 / (lens.length || 1)) * 100).toFixed(1)),
    连贯空缺率: Number(((gaps / (sents.length || 1)) * 100).toFixed(1)),
    拟物动词次数: animacy.length,
    拟物动词每千字: Number(per1k(animacy.length).toFixed(2)),
    长定语连缀每千字: Number(per1k(attrib.length).toFixed(1)),
    长定语样例: attrib.slice(0, 5).map((h) => `${h.count}的@${h.clause.slice(0, 30)}`),
    拟物样例: animacy.slice(0, 5).map((hit) => `${hit.verb}@${hit.sentence.slice(0, 26)}`),
    就近整合超限: splitBad,
    图块数: split.length,
    的密度每千字: Number(per1k(deCount).toFixed(1)),
    路标每千字: Number(per1k(signposts).toFixed(1)),
    衔接词每千字: Number(per1k(connectives).toFixed(1)),
  };
}

/* ── 合成分：相对同一批课件打分 ───────────────────────────────────────────
 *
 * 为什么用相对分位而不是绝对阈值：这批中文课件上「连贯空缺率」恒在 52–66%，
 * 「路标密度」恒在 1.7–8.2/千字——**绝对阈值对这种同源文本没有分辨力**，写死一个
 * 数值只会让每份课件的分一样。而按同一批内的分位打分，问的就是「这一份比同级
 * 其它课件难读还是好读」，那是能回答的问题。
 *
 * 局限（必须写进报告）：分位分只在**同一批**内可比，跨批不可比；一批只有 3 份时
 * 分位极不稳定。批内 < 5 份时降级为绝对阈值并标 ⚠。
 */
export const WEIGHTS = {
  连贯空缺: 0.24,   // A 级：Britton & Gülgöz 1991（补连贯空缺，自由回忆大幅提升）
  拟物动词: 0.18,   // A 级：Clark et al. 2026；lesson-design 第 10 条
  长定语连缀: 0.16, // B 级：同上第 12 条；中文误报率高，权重压低
  就近整合: 0.12,   // A 级：Mayer spatial contiguity d≈0.79（8/8）
  句长: 0.10,       // C 级：无文献阈值，纯编辑约定
  路标: 0.10,       // B 级：Mayer signaling d≈0.41（24/28），取低值
  衔接词: 0.10,     // B 级：与连贯空缺同源的正向指标
};

/** 越低越好的指标 → 0–1 达标度（1 = 这批里最好）。用排名而不是线性带宽。 */
function rankLower(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((value) => {
    const rank = sorted.filter((v) => v < value).length / Math.max(1, sorted.length - 1);
    return 1 - rank;                                    // 越小越好 → 排名越靠前分越高
  });
}

/** 越高越好的指标 → 0–1 达标度。 */
function rankHigher(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((value) => sorted.filter((v) => v < value).length / Math.max(1, sorted.length - 1));
}

/** 绝对阈值版（批内份数太少时降级用）。 */
function absolute(metrics) {
  const bandLow = (v, good, bad) => (v <= good ? 1 : v >= bad ? 0 : 1 - (v - good) / (bad - good));
  const bandHigh = (v, good, bad) => (v >= good ? 1 : v <= bad ? 0 : (v - bad) / (good - bad));
  return {
    连贯空缺: bandLow(metrics.连贯空缺率, 45, 70),
    拟物动词: bandLow(metrics.拟物动词每千字, 0, 2),
    长定语连缀: bandLow(metrics.长定语连缀每千字, 0, 15),
    就近整合: metrics.图块数 === 0 ? 1 : bandLow(metrics.就近整合超限, 0, Math.max(1, metrics.图块数 * 0.5)),
    句长: bandLow(metrics.超60字占比, 5, 30),
    路标: bandHigh(metrics.路标每千字, 6, 1.5),
    衔接词: bandHigh(metrics.衔接词每千字, 12, 4),
  };
}

/** 一批课件一起打分：返回 [{分项, 总分, 模式}]，与输入同序。 */
export function scoreBatch(rows) {
  const useRank = rows.length >= 5;
  const parts = rows.map(() => ({}));
  if (useRank) {
    const lower = {
      连贯空缺: '连贯空缺率',
      拟物动词: '拟物动词每千字',
      长定语连缀: '长定语连缀每千字',
      句长: '超60字占比',
    };
    for (const [key, metric] of Object.entries(lower)) {
      const values = rankLower(rows.map((row) => row[metric]));
      values.forEach((value, index) => { parts[index][key] = value; });
    }
    const higher = { 路标: '路标每千字', 衔接词: '衔接词每千字' };
    for (const [key, metric] of Object.entries(higher)) {
      const values = rankHigher(rows.map((row) => row[metric]));
      values.forEach((value, index) => { parts[index][key] = value; });
    }
    // 就近整合是计数，直接按「超限占比」排名
    const splitValues = rankLower(rows.map((row) => (row.图块数 === 0 ? 0 : row.就近整合超限 / row.图块数)));
    splitValues.forEach((value, index) => { parts[index].就近整合 = value; });
  } else {
    rows.forEach((row, index) => { parts[index] = absolute(row); });
  }

  return rows.map((row, index) => {
    const local = parts[index];
    let total = 0;
    for (const [key, weight] of Object.entries(WEIGHTS)) total += weight * local[key];
    return {
      分项: Object.fromEntries(Object.entries(local).map(([k, v]) => [k, Number((v * 100).toFixed(1))])),
      总分: Number((total * 100).toFixed(1)),
      模式: useRank ? '批内分位' : '绝对阈值',
    };
  });
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (targets.length === 0) { console.error('用法：node analyze.mjs <文件或目录> [...]'); process.exit(2); }
  const files = [];
  for (const target of targets) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(target, entry.name));
      }
    } else files.push(target);
  }
  files.sort();

  const rows = files.map((file) => ({ 课件: path.basename(file), ...analyze(fs.readFileSync(file, 'utf8')) }));
  const scored = scoreBatch(rows);
  rows.forEach((row, index) => Object.assign(row, scored[index]));

  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log([`模式：${scored[0].模式}`, '', '课件', '总分', '连贯空缺', '拟物', '定语嵌套', '就近', '句长', '路标', '衔接'].join('\t'));
    const rank = (key) => rows.map((row) => row[key]).sort((a, b) => b - a);
    const order = [...rows].sort((a, b) => b.总分 - a.总分);
    for (const row of order) {
      console.log([row.课件, row.总分, row.分项.连贯空缺, row.分项.拟物动词, row.分项.长定语连缀,
        row.分项.就近整合, row.分项.句长, row.分项.路标, row.分项.衔接词].join('\t'));
    }
    void rank;
  }
}
