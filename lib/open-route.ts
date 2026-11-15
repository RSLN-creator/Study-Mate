/* ─────────────────────────────────────────────────────────────────────────
   StudyMate · Host 半路由 —— 「用默认应用打开这份资料」

   `POST /api/studymate/open` 是阅读端把「把这个文件交给操作系统」交给 Host 半的唯一入口。
   为什么必须有它：参考资料里的 `.xlsx`／`.pdf`／`.py` 这类**浏览器页面打不开也读不出**，
   而学生要的是「双击就用默认应用打开」——页面侧做不到（`file://` 从 http 页面被浏览器挡），
   所以只能由宿主半去调操作系统的 shell。

   **这条路由是本插件里唯一一条「会启动进程」的路由**，所以围栏写在这里必须最紧：

     · 目标只能是**本科目目录下的既有文件**（`<workspace>/.learning/subjects/<slug>/…`）。
       `workspace` 取自 `~/.dsh/studymate-config.yaml`，`relPath` 由阅读端给；
       解析后的绝对路径必须仍在科目目录之下——`..` 与绝对路径都在这一步被挡掉
       （`path.resolve` 先归一，再比前缀；比之前两边的分隔符与大小写按平台归一）。
     · 只认**常规文件**：目录、设备、符号链接指向的外面一律不开。
     · 只认两种动作：`open`（默认应用打开）与 `reveal`（在资源管理器/访达里定位）。
       动作名是白名单，**不接受任何来自请求的命令行参数**——拼命令行的只有下面那两个常量数组，
       目标路径永远是**单独一个 argv**，不经过 shell 拼接。

   注册约定与另外几条路由逐字相同：收外层 ctx、自己 `inject(['connection'])`，
   缺 connection 就不挂（headless / 更老的宿主），挂不上只是这一个功能不可用。
   ───────────────────────────────────────────────────────────────────────── */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

import { routeError } from './route-envelope.ts';

/** 路由路径：阅读端 `lib/client.js` 的 OPEN_ENDPOINT 必须与它逐字一致。 */
export const OPEN_PATH = '/api/studymate/open';

/** 认得的两件动作。别的值一律 400，不做「猜一个最接近的」。 */
export const OPEN_MODES = ['open', 'reveal'] as const;
export type OpenMode = (typeof OPEN_MODES)[number];

/** connection 的精确路由表（形状由宿主决定，这里只描述用得到的成员）。 */
interface FetchRegistry {
  register(route: {
    path: string;
    methods: string[];
    requestBody: 'buffered';
    fetch: (request: Request) => Promise<Response> | Response;
  }): unknown;
}

interface ConnectionContext {
  connection?: { fetch?: FetchRegistry };
  effect?: (fn: () => unknown, description?: string) => unknown;
}

interface RouteContext {
  inject?: (names: string[], handler: (ctx: ConnectionContext) => unknown) => unknown;
}

/** 没找到工作区时给的话与另外两条路由同一句：学生照这句话就能自救。 */
const NO_WORKSPACE = '没找到学习工作区：~/.dsh/studymate-config.yaml 里没有 workspace。先跑一次 npx @yunmiao/studymate install。';

/** 一次解析的结果：要么给出可打开的绝对路径，要么给出拒绝的码与话。 */
export type OpenTarget =
  | { ok: true; dir: string; target: string; rel: string }
  | { ok: false; status: number; code: string; message: string };

/** 平台归一：比前缀之前先把分隔符与大小写按平台抹平（Windows 上两者都无关紧要）。 */
function sameCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** `target` 是不是在 `root` 之下（含等于 root 本身的情形，由调用方再排除）。 */
function isUnder(root: string, target: string): boolean {
  const a = sameCase(path.resolve(target));
  const b = sameCase(path.resolve(root));
  if (a === b) return true;
  const withSep = b.endsWith(path.sep) ? b : b + path.sep;
  return a.startsWith(withSep);
}

/**
 * 把请求里的 `subject` + `path` 解析成一个**可安全打开**的绝对路径。纯函数（只读盘、不启动进程），
 * 所以围栏能脱离「真去开一个进程」来断言。
 *
 * 拒绝的四种情形各有自己的码：`subject-invalid`（slug 形状不对）、`path-invalid`（越出科目目录
 * 或形状不对）、`not-found`（盘上没有）、`not-a-file`（不是常规文件）。
 */
export function resolveOpenTarget(input: { workspace?: unknown; subject?: unknown; relPath?: unknown } = {}): OpenTarget {
  const workspace = typeof input.workspace === 'string' ? input.workspace.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const relPath = typeof input.relPath === 'string' ? input.relPath.trim() : '';
  if (!workspace || !subject) {
    return { ok: false, status: 400, code: 'subject-invalid', message: '要给出 subject（科目 slug）' };
  }
  // slug 只允许一层目录名：科目目录就是 `.learning/subjects/<slug>`，多余的斜杠不算 slug
  if (subject.includes('/') || subject.includes('\\') || subject === '.' || subject === '..') {
    return { ok: false, status: 400, code: 'subject-invalid', message: `科目 slug 形状不对：${subject}` };
  }
  if (!relPath) {
    return { ok: false, status: 400, code: 'path-invalid', message: '要给出 path（科目目录下的相对路径）' };
  }
  const dir = path.resolve(workspace, '.learning', 'subjects', subject);
  // path.resolve 会把 `..` 与绝对路径都归一掉，所以「越界」在下一句就被挡下——
  // 不需要再单独判 `..`（判两遍就有了两套判据，迟早不一致）。
  const target = path.resolve(dir, relPath);
  if (!isUnder(dir, target)) {
    return { ok: false, status: 400, code: 'path-invalid', message: '只允许打开本科目目录下的文件' };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return { ok: false, status: 404, code: 'not-found', message: '这个文件不在盘上（搬过目录？）' };
  }
  // statSync 跟符号链接：链到科目目录**之外**的目标不算「在这个目录下」，所以还要再判一次
  if (!stat.isFile()) {
    return { ok: false, status: 400, code: 'not-a-file', message: '只能打开常规文件' };
  }
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    return { ok: false, status: 404, code: 'not-found', message: '这个文件不在盘上（搬过目录？）' };
  }
  if (!isUnder(dir, real)) {
    return { ok: false, status: 400, code: 'path-invalid', message: '这个链接指向科目目录之外' };
  }
  return { ok: true, dir, target: real, rel: path.relative(dir, real).split(path.sep).join('/') };
}

/** 注入点：套件用它替掉真启动，断言的是**命令行的形状**而不是真去开一个窗口。 */
export type SpawnOpen = (command: string, args: string[]) => unknown;

/**
 * 拼出「用默认应用打开 / 在文件管理器里定位」的那条命令，并交出去执行。
 *
 * 目标路径**永远是单独一个 argv**：`cmd /c start "" <path>` 里那个空字符串是 `start` 的
 * 窗口标题占位（缺了它，带引号的路径会被 `start` 当成标题），此后不再有任何拼接——
 * 学生给的文件名里带空格、`&`、`%` 都不会变成命令的一部分。
 */
export function spawnOpen(target: string, mode: OpenMode, platform: string = process.platform, spawnImpl: SpawnOpen = defaultSpawn): void {
  const detached = { detached: true, stdio: 'ignore' as const, windowsHide: true };
  if (platform === 'win32') {
    const child = mode === 'reveal'
      ? spawnImpl('explorer.exe', [`/select,${target}`])
      : spawnImpl('cmd.exe', ['/c', 'start', '', target]);
    // 不问结果：`start` 与 `explorer` 都会立刻返回，退出码不表示「学生看到了那个窗口」
    unrefQuietly(child);
    return;
  }
  if (platform === 'darwin') {
    const child = mode === 'reveal' ? spawnImpl('open', ['-R', target]) : spawnImpl('open', [target]);
    unrefQuietly(child);
    return;
  }
  // Linux 系：`reveal` 没有统一做法，退回「打开它所在的那一层目录」
  const child = mode === 'reveal'
    ? spawnImpl('xdg-open', [path.dirname(target)])
    : spawnImpl('xdg-open', [target]);
  unrefQuietly(child);
  void detached;
}

function defaultSpawn(command: string, args: string[]): unknown {
  return spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
}

/** 子进程不 join 父进程的退出：宿主关掉时这些窗口该留着。 */
function unrefQuietly(child: unknown): void {
  const one = child as { unref?: () => void; on?: (event: string, handler: () => void) => void };
  if (one && typeof one.on === 'function') one.on('error', () => { /* 开不起来就是没开成，不抛 */ });
  if (one && typeof one.unref === 'function') one.unref();
}

/**
 * 把「打开资料」端点挂到插件上。与 `registerProgressRoutes` 同一种姿势：
 * 收外层 ctx、自己 `inject(['connection'])`，`connection` 就绪才注册。
 */
export function registerOpenRoutes(ctx: RouteContext | null | undefined): void {
  if (!ctx || typeof ctx.inject !== 'function') return;
  ctx.inject(['connection'], (connectionCtx: ConnectionContext) => {
    const connection = connectionCtx?.connection;
    if (!connection?.fetch?.register || typeof connectionCtx.effect !== 'function') return;
    try {
      connectionCtx.effect(() => connection.fetch!.register({
        path: OPEN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: handleOpen,
      }), 'studymate: 打开资料路由');
    } catch (error) {
      console.warn(`StudyMate：打开资料路由没挂上。${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/**
 * 一次「打开资料」。请求体：
 *   `{ subject, path, mode? }`
 *     · `subject`：科目 slug；`path`：**科目目录下**的相对路径（`reference/…`、`sources/…`）；
 *     · `mode`：`"open"`（默认，用系统的默认应用打开）或 `"reveal"`（在文件管理器里定位）。
 *
 * 返回：
 *   200 `{ ok: true, mode, file, dir }`——`file`/`dir` 都是**科目目录下的相对路径**，
 *       不回显绝对路径（学生不需要，也少一处把本机目录结构送出去的地方）；
 *   400 `{ ok: false, error: { code, message } }`——`subject-invalid` / `path-invalid` /
 *       `not-a-file` / `mode-invalid` / `body-invalid`；
 *   404 `not-found`；405 `method-not-allowed`；500 `no-workspace` / `open-failed`。
 */
export async function handleOpen(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return routeError(405, 'method-not-allowed', '打开资料只收 POST');
    }
    const { resolveWorkspace } = await import('./workspace.ts');
    const workspace = resolveWorkspace();
    if (!workspace) {
      return routeError(500, 'no-workspace', NO_WORKSPACE);
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return routeError(400, 'body-invalid', '请求体要是 JSON 对象：{ subject, path, mode? }');
    }
    const rawMode = body.mode === undefined || body.mode === null ? 'open' : String(body.mode);
    const mode = (OPEN_MODES as readonly string[]).includes(rawMode) ? rawMode as OpenMode : null;
    if (!mode) {
      return routeError(400, 'mode-invalid', `mode 只认 ${OPEN_MODES.join(' / ')}，收到的是 ${JSON.stringify(body.mode)}`);
    }
    const target = resolveOpenTarget({ workspace, subject: body.subject, relPath: body.path });
    if (!target.ok) {
      return routeError(target.status, target.code, target.message);
    }
    try {
      spawnOpen(target.target, mode, process.platform === 'win32' && !process.env.STUDYMATE_OPEN_DRYRUN ? 'win32' : process.platform);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return routeError(500, 'open-failed', `交给系统的时候失败了：${message}`);
    }
    return Response.json({
      ok: true,
      mode,
      file: target.rel,
      dir: path.relative(path.resolve(workspace), path.dirname(target.target)).split(path.sep).join('/'),
      host: os.platform(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return routeError(500, 'internal', message);
  }
}
