/* ─────────────────────────────────────────────────────────────────────────
   StudyMate · Host 半数据层 —— 进度的「读完」一步

   `subjects/<slug>/progress.yaml` 的 `nodes.<节点id>.status` 一直**只有 agent 写**（目标态规格
   §4.3 那条「学习内容只有 agent 写」）。这一层多开一条窄路：学生在阅读端把一课读到末尾，
   那一刻由阅读端把它置为「已学完」——决定与被否备选见 ADR-0015，判据是纯函数域的
   `lib/core/rules.ts` 里那个 `读完` 推进事件。

   为什么值得单开（ADR-0010 末句「下一个想从界面直接改进度的人会拿它当依据，答案是不行」
   说的是**另一件事**）：`读完` 是**事实**，不是判断。学生在哪一页停下的，阅读端知道得最清楚；
   绕回会话让总控转述，只是把一个已知事实再问一遍。而需要判断的两处仍归 agent——独立证据
   够不够（`证据通过`）与实验课验收结论。所以这条路的范围写死在**一个字段**上：
   只有 `nodes.<节点id>.status`，只认 `event: "读完"`，别的键一个都不碰。

   写入沿用 `attempts/` 那两件已经验证过的武器（判据在 `lib/core/fence.ts`）：
     · **幂等**：同一个 `operationId` 重放只回放上次的回执，不写第二遍；
     · **版本号**：`expectedVersion` 对不上就拒绝并**重读**当前内容，绝不覆盖别人的改动。
   并发来自两侧：学生读到末尾的这一刻，与 agent 正在改同一份 progress（补 notes、加节点）。

   **保形是这一层的硬要求**：progress.yaml 里既有用户手写的 `notes`，也有文件自带的注释，
   还有别的节点与 `project`。所以这里**不做**「解析成对象再序列化回去」（那会把注释与写法
   全抹掉），而是**文本手术**：只改 `status` 那一行的值，节点不在才在 `nodes:` 块末尾追加一块。
   结构认不出来的（行内流式集合、同一个节点写了两次…）一律拒绝，不猜——猜错的代价是抹掉
   用户写的字。

   这一层也不读钟：`progress.schema.json` 的节点上只有 `status` 与 `notes` 两个字段，
   `updated_at` 是科目级时间戳、不归这条路改（收据里的 `version` 是内容哈希，不带时间）。
   ───────────────────────────────────────────────────────────────────────── */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { advance, toTier } from './core/rules.ts';
import type { Tier } from './core/rules.ts';
import { IdempotencyLedger, checkOperationId, fingerprintOf, OPERATION_ID_MAX } from './core/fence.ts';
import { errorBody } from './route-envelope.ts';
import type { RouteErrorEnvelope } from './route-envelope.ts';
import { parseYaml } from './yaml.ts';

/* ── 常量与形状 ─────────────────────────────────────────────────────────── */

/** 科目目录下的进度文件名。 */
export const PROGRESS_FILE = 'progress.yaml';

/** 这条路唯一认的推进事件名（与 `lib/core/rules.ts` 的 `ProgressEvent.kind` 逐字一致）。 */
export const FINISH_EVENT = '读完';

/** 节点 id 的写法与 `curriculum.schema.json` 的 `nodes[].id` 逐字一致；不合法就不拼键名。 */
const NODE_ID_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

/** 节点的课型：只有 `实验` 不走「读完」那条路（它按验收结论置位，见 learning-system）。 */
const LAB_KIND = '实验';

/** 一次写入的回执。字段与客户端同事约定的接口逐字一致（ADR-0015 的契约那一节）。 */
export interface ProgressSuccess {
  ok: true;
  node: string;
  tier: Tier;
  changed: boolean;
  reason: string;
  /** 写完之后重读的那一份版本号（内容哈希）；下一个 `expectedVersion` 就是它 */
  version: string;
  /** progress.yaml 相对**工作区**的路径（界面拿来显示「写进哪一份文件」） */
  progress: string;
}

/** 拒绝写入：HTTP 语义由路由层映射成状态码。
 *  形状就是阅读端路由的唯一错误信封（`lib/route-envelope.ts`）：`error` 是 `{ code, message }`。 */
export interface ProgressRefusal extends RouteErrorEnvelope {
  status: number;
  /** 冲突（409）时顺手带回去的当前版本号：界面不必再跑一趟 */
  version?: string;
}

export type ProgressWriteResult = ProgressSuccess | ProgressRefusal;

/**
 * 幂等台账：`operationId` → { fingerprint, response }。**只在内存里**，只防同一个宿主进程内的
 * 双击与重试。与 `reference.ts` / `attempts.ts` 各持一份实例：三份台账的指纹算法不同，
 * 共用一个 Map 会互相挤掉（上限是共享的）。
 */
const LEDGER = new IdempotencyLedger<ProgressWriteResult>();

/* ── 路径与小工具 ───────────────────────────────────────────────────────── */

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function readTextIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 科目目录的绝对路径。subject 里出现分隔符或 `..` 直接判不合法（与 lib/attempts.ts 一致）。 */
function subjectDirOf(workspace: unknown, subject: unknown): string | null {
  if (typeof workspace !== 'string' || !workspace) return null;
  if (typeof subject !== 'string' || !subject || subject.includes('/') || subject.includes('\\') || subject.includes('..')) return null;
  return path.resolve(workspace, '.learning', 'subjects', subject);
}

/**
 * 节点 id 合不合法。合法才拼得出 progress.yaml 里的键——`../` 之类的写法在这里就被挡下，
 * 不靠「拼完再检查」兜底（那种写法漏一次就是点到别的科目去）。
 */
function isValidNodeId(node: unknown): node is string {
  return typeof node === 'string' && NODE_ID_RE.test(node);
}

/**
 * 文件内容的版本号（16 位 hex）；文件不在返回空串。
 *
 * **只哈希内容**，不掺 mtime——与 `lib/attempts.ts` 同一口径：progress.yaml 是我们与 agent 写的，
 * 内容自证最准；mtime 会因为备份、同步、`touch` 而抖，抖一次就是一次假冲突。
 * 版本号**不写进文件**（写进去就成了「文件里那份」与「读它算出来的那份」两个值）。
 */
function versionOfText(text: string | null): string {
  if (text === null) return '';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** 回执里的 `progress`：相对工作区的路径（`.learning/subjects/<slug>/progress.yaml`）。 */
function progressRelOf(subject: string): string {
  return path.posix.join('.learning', 'subjects', subject, PROGRESS_FILE);
}

/* ── 读盘 ──────────────────────────────────────────────────────────────── */

interface LoadedProgress {
  text: string;
  version: string;
}

/** 读一份 progress.yaml；文件不在返回 null（「没有这份文件」与「读得到但是空的」要分得开）。 */
function loadProgress(subjectDir: string): LoadedProgress | null {
  const text = readTextIfPresent(path.join(subjectDir, PROGRESS_FILE));
  if (text === null) return null;
  return { text, version: versionOfText(text) };
}

/** 现有 progress.yaml 的版本号；文件不在返回空串（与 `attemptsVersion` 同一形状的出口）。 */
export function progressVersion({ workspace, subject }: { workspace?: unknown; subject?: unknown } = {}): string {
  const subjectDir = subjectDirOf(workspace, subject);
  if (subjectDir === null) return '';
  const loaded = loadProgress(subjectDir);
  return loaded === null ? '' : loaded.version;
}

/**
 * 节点在大纲里的课型。返回 `null` = 大纲读不出来（认不出这个节点是不是实验课）；
 * `known: false` = 这个 id 不在 `curriculum.yaml` 的 `nodes:` 里。
 *
 * 为什么要读大纲：进度只记大纲里的节点（`lib/library.ts` 的节点表就来自大纲），写一个
 * 大纲里没有的 id 只会留下一份谁也看不见的死数据；而 `kind` 决定「读完」这条路适不适用。
 */
function nodeInCurriculum(subjectDir: string, node: string): { known: boolean; kind: string } | null {
  const file = path.join(subjectDir, 'curriculum.yaml');
  const text = readTextIfPresent(file);
  if (text === null) return null;
  let value: unknown;
  try {
    value = parseYaml(text, { file });
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const nodes = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return null;
  for (const item of nodes) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.id !== node) continue;
    // 没写 kind 的节点按 library.ts 的默认走（概念）
    return { known: true, kind: typeof record.kind === 'string' && record.kind !== '' ? record.kind : '概念' };
  }
  return { known: false, kind: '' };
}

/* ── 文本手术（保形写回）──────────────────────────────────────────────────
   下面的判据只覆盖 progress.yaml 真用得上的写法，刻意比 `lib/yaml.ts` 窄：
     · 顶层键在行首（`nodes:`、`project:`、`updated_at:`）；
     · 节点的键是**明文** id（`NODE_ID_RE`，不含引号与冒号）；
     · 值要么是块 mappings（键行空着、子行缩进更深），要么是空 mapping `{}`。
   其余写法（行内流式集合带内容、同一个节点写两次、块标量…）一律返回 null 让调用方拒绝——
   这一层不猜，猜错就是抹掉用户写的字。 */

/** 拆一行自己的换行符：`\r` 留着，别的原样（`split('\n')` 之后每段自带 `\r`）。 */
function splitEol(part: string): { content: string; eol: string } {
  return part.endsWith('\r') ? { content: part.slice(0, -1), eol: '\r' } : { content: part, eol: '' };
}

function indentOf(content: string): number {
  let count = 0;
  while (count < content.length && content[count] === ' ') count++;
  return count;
}

function isBlankOrComment(content: string): boolean {
  const text = content.trim();
  return text === '' || text.startsWith('#');
}

/**
 * 行尾注释的起点：`#` 在行首或前面是空白时才是注释，且不能在引号里。
 * 返回 `{ value, comment }`——`comment` 连同它前面的空白一起留着，改值时原样贴回去。
 */
function stripInlineComment(text: string): { value: string; comment: string } {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (inDouble) {
      if (ch === '\\') index++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (text[index + 1] === "'") index++;
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '#' && (index === 0 || text[index - 1] === ' ' || text[index - 1] === '\t')) {
      let start = index;
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
      return { value: text.slice(0, start), comment: text.slice(start) };
    }
  }
  return { value: text, comment: '' };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 一段区间的非空行里最浅的缩进（新块的子行缩进照它算）；区间里没有非空行返回 null。 */
function shallowestIndent(parts: readonly string[], from: number, to: number): string | null {
  let best: string | null = null;
  for (let index = from; index < to; index++) {
    const { content } = splitEol(parts[index]);
    if (isBlankOrComment(content)) continue;
    const indent = content.slice(0, indentOf(content));
    if (best === null || indent.length < best.length) best = indent;
  }
  return best;
}

/**
 * 把 `<节点id>` 的 `status` 就地改成新档位，**只改这一处**：
 *   · 节点在 → 改它 `status:` 那一行的值（行尾注释原样留着）；块里没有 status 就在块首补一行；
 *   · 节点不在 → 在 `nodes:` 块的末尾追加一个两行的节点块（`nodes: {}` 先展开成块）；
 *   · 别的节点、`notes`、`project`、注释、行序、各行自己的换行风格一个都不动。
 *
 * `known` 是**解析出来的**那份值里这个节点在不在（断言两套读法一致）：文本扫描认不出、
 * 但解析树里有（例如节点键带了引号），或者反过来——都返回 null 让调用方拒绝。
 * 不加这条就会在「同一个节点、两种写法」时追加出一个重复键（YAML 后写的生效，静默盖掉原来那份）。
 *
 * 返回 null = 文件不是这一层敢就地改的形状（调用方按「结构认不出来」拒绝）。
 */
export function setNodeStatus(text: string, node: string, tier: Tier, known: boolean): string | null {
  const parts = text.split('\n');           // 只按 \n 切：每段自带 \r，重建时 join('\n') 就复原了
  const eol = text.includes('\r\n') ? '\r' : '';   // 新插入的行沿用文件的换行风格

  let nodesAt = -1;
  for (let index = 0; index < parts.length; index++) {
    const { content } = splitEol(parts[index]);
    if (!/^nodes\s*:/.test(content)) continue;
    if (nodesAt !== -1) return null;        // 两个顶层 `nodes:`：谁生效不好说，不猜
    nodesAt = index;
  }
  if (nodesAt === -1) return null;

  const nodesLine = splitEol(parts[nodesAt]);
  const nodesValue = stripInlineComment(nodesLine.content.slice(nodesLine.content.indexOf(':') + 1)).value.trim();
  if (nodesValue !== '' && nodesValue !== '{}') return null;   // 行内流式集合带内容：不就地改

  // nodes 块的范围：从它下一行起，到第一个行首的非空非注释行为止
  let blockEnd = parts.length;
  for (let index = nodesAt + 1; index < parts.length; index++) {
    const { content } = splitEol(parts[index]);
    if (isBlankOrComment(content)) continue;
    if (indentOf(content) === 0) { blockEnd = index; break; }
  }

  // 追加点：块里最后一个非空行之后（块尾的空行与注释留在新块之后，位置不动）
  let appendAt = blockEnd;
  while (appendAt > nodesAt + 1 && isBlankOrComment(splitEol(parts[appendAt - 1]).content)) appendAt--;

  const nodeRe = new RegExp(`^(\\s*)${escapeRegExp(node)}\\s*:\\s*(.*)$`);
  let nodeAt = -1;
  let nodeIndent = '';
  for (let index = nodesAt + 1; index < blockEnd; index++) {
    const { content } = splitEol(parts[index]);
    const match = nodeRe.exec(content);
    if (match === null) continue;
    if (nodeAt !== -1) return null;         // 同一个节点写了两次：不猜哪个生效
    nodeAt = index;
    nodeIndent = match[1];
    // 节点行自己带值（`net.layers: {status: 学习中}` 这类行内写法）：不就地改
    if (stripInlineComment(match[2]).value.trim() !== '') return null;
  }

  if (nodeAt === -1) {
    if (known) return null;                 // 解析树里有、文本扫描认不出：两套读法不一致，不猜
    // 节点不在：`nodes: {}` 展开成块，再在块尾追加一个节点块
    if (nodesValue === '{}') parts[nodesAt] = `nodes:${nodesLine.eol}`;
    const childIndent = shallowestIndent(parts, nodesAt + 1, blockEnd) ?? '  ';
    parts.splice(appendAt, 0,
      `${childIndent}${node}:${eol}`,
      `${childIndent}  status: ${tier}${eol}`);
    return parts.join('\n');
  }

  if (nodeAt !== -1 && !known) return null;   // 文本里认得出、解析树里没有：两套读法不一致，不猜

  // 节点块的范围：缩进比节点行深的行（空行与注释跟着走）
  let nodeEnd = blockEnd;
  for (let index = nodeAt + 1; index < blockEnd; index++) {
    const { content } = splitEol(parts[index]);
    if (isBlankOrComment(content)) continue;
    if (indentOf(content) <= nodeIndent.length) { nodeEnd = index; break; }
  }

  let statusAt = -1;
  for (let index = nodeAt + 1; index < nodeEnd; index++) {
    const { content } = splitEol(parts[index]);
    if (!/^\s*status\s*:/.test(content)) continue;
    if (statusAt !== -1) return null;       // 同一个节点两条 status：不猜哪条生效
    statusAt = index;
  }

  if (statusAt !== -1) {
    const line = splitEol(parts[statusAt]);
    const match = /^(\s*)status(\s*):(\s*)(.*)$/.exec(line.content);
    if (match === null) return null;
    const { comment } = stripInlineComment(match[4]);
    parts[statusAt] = `${match[1]}status: ${tier}${comment}${line.eol}`;
    return parts.join('\n');
  }

  // 节点在、但没有 status 行（schema 要求必备，正常文件不会有）：在块首按兄弟行的缩进补一行
  const childIndent = shallowestIndent(parts, nodeAt + 1, nodeEnd) ?? `${nodeIndent}  `;
  parts.splice(nodeAt + 1, 0, `${childIndent}status: ${tier}${eol}`);
  return parts.join('\n');
}

/**
 * 从解析出来的 progress 值里取一个节点：在不在（`present`）与它的 status 原值（旧六档词原样带回，
 * 交给 `advance` 归一）。`present` 是**文本手术那边的对账锚**：两套读法对不上时宁可拒绝。
 */
function progressNodeOf(value: unknown, node: string): { present: boolean; status?: string } {
  if (typeof value !== 'object' || value === null) return { present: false };
  const nodes = (value as { nodes?: unknown }).nodes;
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) return { present: false };
  // `Object.hasOwn`：节点名恰好写成 `constructor` / `__proto__` 时不取原型上的东西
  if (!Object.hasOwn(nodes, node)) return { present: false };
  const run = (nodes as Record<string, unknown>)[node];
  if (typeof run !== 'object' || run === null) return { present: false };
  const status = (run as Record<string, unknown>).status;
  return { present: true, status: typeof status === 'string' ? status : undefined };
}

/* ── 写入 ──────────────────────────────────────────────────────────────── */

function refusal(status: number, error: string, message: string): ProgressRefusal {
  return { status, ...errorBody(error, message) };
}

/**
 * 一次「读完」写入。返回 `{ok:true, node, tier, changed, reason, version, progress}`
 * 或 `{ok:false, status, error:{code,message}, version?}`。
 *
 * 拒绝码：`operation-id-invalid` / `subject-invalid` / `node-invalid` /
 * `progress-missing` / `progress-invalid` / `event-invalid` /
 * `expected-version-required` / `operation-id-conflict` / `version-conflict` / `write-failed`。
 *
 * `event` 只认 `"读完"`；别的值按「不认识的输入」拒绝（这条路不是通用的进度写入口）。
 * `kind: 实验` 的节点**不动**：它按验收结论置位（`learning-system` 的验收时机）——
 * 回一份 `ok:true, changed:false` 的收据，而不是报错：学生读完说明页是事实，只是它不置位。
 */
export function writeProgress({ workspace, subject, node, event, expectedVersion, operationId }:
  { workspace?: unknown; subject?: unknown; node?: unknown; event?: unknown;
    expectedVersion?: unknown; operationId?: unknown } = {}): ProgressWriteResult {
  // 先把请求体过一遍再碰台账：坏请求不该占用一个 operationId（与 writeAttempts 同一顺序）
  const verdict = checkOperationId(operationId);
  if (!verdict.ok) {
    return refusal(400, 'operation-id-invalid',
      `缺少或过长的 operationId（上限 ${OPERATION_ID_MAX} 字符）：没有它没法区分重复提交与新提交`);
  }
  const opId = verdict.id;

  const subjectDir = subjectDirOf(workspace, subject);
  if (subjectDir === null) {
    return refusal(400, 'subject-invalid', '科目名不合法：不能为空，也不能带 / 、\\ 或 ..');
  }
  if (!isDirectory(subjectDir)) {
    return refusal(400, 'subject-invalid', `科目不存在：${String(subject)}`);
  }
  if (!isValidNodeId(node)) {
    return refusal(400, 'node-invalid',
      `节点 id 不合法：${JSON.stringify(node)}（要匹配 curriculum.yaml 的 nodes[].id：小写字母数字，用 . 或 - 分段）`);
  }
  if (event !== FINISH_EVENT) {
    return refusal(400, 'event-invalid',
      `不认识的推进事件 ${JSON.stringify(event)}：这条路只认「${FINISH_EVENT}」（学生通读到末尾）——`
      + '别的推进（独立证据、复习）走学习会话，不在阅读端。');
  }

  const loaded = loadProgress(subjectDir);
  if (loaded === null) {
    return refusal(400, 'progress-missing',
      `找不到 ${PROGRESS_FILE}：这门课还没有「学习进度」这份文件（建课时会建），先在会话里让总教练把它建出来`);
  }
  // 解析一遍再动它：坏文件的结构不猜（这一层只做文本手术，但至少要知道它读得进）
  let parsed: unknown;
  try {
    parsed = parseYaml(loaded.text, { file: path.join(subjectDir, PROGRESS_FILE) });
  } catch (error) {
    return refusal(400, 'progress-invalid',
      `${PROGRESS_FILE} 读不出来：${error instanceof Error ? error.message : String(error)}——先修好它再标读完（这一层不猜坏文件的结构）`);
  }
  const { present: known, status: before } = progressNodeOf(parsed, node);

  const expected = expectedVersion === undefined || expectedVersion === null ? '' : String(expectedVersion).trim();
  if (expected === '') {
    return refusal(400, 'expected-version-required',
      '缺少 expectedVersion：先读一次 payload 拿到该科目的 progress_version 再写（没有它挡不住覆盖别人的改动）');
  }

  const fingerprint = fingerprintOf([String(subject), node, FINISH_EVENT]);

  // 幂等回放放在版本校验**之前**：第一次写成功之后版本号已经变了，重试带回来的
  // expectedVersion 必然是旧的，先校版本就会把一次正常的重试误判成冲突。
  const lookup = LEDGER.lookup(opId, fingerprint);
  if (lookup.kind === 'replay') return lookup.response;
  if (lookup.kind === 'conflict') {
    return {
      ...refusal(409, 'operation-id-conflict',
        `同一个 operationId 又提交了别的内容（这次是节点 ${node}）：换个 operationId 再写（这次不写盘）`),
      version: loaded.version,
    };
  }

  if (expected !== loaded.version) {
    // 冲突时拒绝写入并**重读**：把当前版本号一起带回去，界面据此重读、不必再跑一趟
    return {
      ...refusal(409, 'version-conflict',
        '学习进度已经变了：版本号对不上，这次不写（请按当前内容重来）'),
      version: loaded.version,
    };
  }

  // 大纲里的课型：实验课只按验收结论置位，「读完」不改它（learning-system 的验收时机）
  const curriculum = nodeInCurriculum(subjectDir, node);
  if (curriculum === null) {
    return refusal(400, 'node-invalid',
      `认不出节点 ${node}：curriculum.yaml 读不出来——先修好大纲再标读完（进度只记大纲里的节点）`);
  }
  if (!curriculum.known) {
    return refusal(400, 'node-invalid',
      `节点 ${node} 不在 curriculum.yaml 的 nodes 里：进度只记大纲里有的节点（核对节点 id 是否写对）`);
  }

  const progressRel = progressRelOf(String(subject));
  if (curriculum.kind === LAB_KIND) {
    const tier = toTier(before);
    const response: ProgressWriteResult = {
      ok: true,
      node,
      tier,
      changed: false,
      reason: `实验课只按验收结论置位：读完不改动（kind: ${LAB_KIND} 的课走 practice-evaluator 的验收时机）`,
      version: loaded.version,
      progress: progressRel,
    };
    LEDGER.remember(opId, fingerprint, response);
    return response;
  }

  const result = advance(before, { kind: FINISH_EVENT });
  if (!result.changed) {
    // 已经是「已学完」：一个字都不写（连字节都不动），回当前版本号
    const response: ProgressWriteResult = {
      ok: true,
      node,
      tier: result.to,
      changed: false,
      reason: result.reason,
      version: loaded.version,
      progress: progressRel,
    };
    LEDGER.remember(opId, fingerprint, response);
    return response;
  }

  const body = setNodeStatus(loaded.text, node, result.to, known);
  if (body === null) {
    return refusal(400, 'progress-invalid',
      `${PROGRESS_FILE} 里 ${node} 的写法这一层不敢就地改（行内流式集合、同一个节点写了两次…）：`
      + '先按块 mappings 重写这一段再标读完');
  }

  try {
    fs.writeFileSync(path.join(subjectDir, PROGRESS_FILE), body, 'utf8');
  } catch (error) {
    return refusal(500, 'write-failed',
      `写不了 ${PROGRESS_FILE}：${error instanceof Error ? error.message : String(error)}`);
  }

  const response: ProgressWriteResult = {
    ok: true,
    node,
    tier: result.to,
    changed: true,
    reason: result.reason,
    version: versionOfText(body),
    progress: progressRel,
  };
  LEDGER.remember(opId, fingerprint, response);
  return response;
}
