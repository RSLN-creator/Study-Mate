// Keep CI's functional suites explicit so optional audits do not grow the gate.
// 「显式」的代价是新增套件会静默地永远不跑——所以下面有一条覆盖断言兜着。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// 支持文件与「按需手动跑」的脚本：新增套件要么接进某个组或 package.json 的按需入口，
// 要么明确登记到这里——不登记就会在下面报出来，不再有第三种「谁也不跑」的状态。
// browser/harness.mjs 是浏览器套件共用的骨架（探测二进制 + CDP + summary.json），自己不是套件。
const SUPPORT_FILES = new Set(['README.md', 'run_tests.sh', 'browser/harness.mjs']);
const MANUAL_ONLY = new Set([
  'browser/measure.mjs', 'browser/hovers.mjs', 'browser/shot.mjs',  // 手动看的浏览器脚本
  'probe_bundle.mjs',                                               // 排障用
]);

function suiteFiles() {
  const found = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__' && entry.name !== 'fixtures') walk(path.join(dir, entry.name), relative);
        continue;
      }
      if (/\.[cm]?js$/.test(entry.name)) found.push(relative);
    }
  };
  walk(path.join(root, 'scripts', 'tests'));
  return found;
}

function declaredSuites() {
  const declared = new Set();
  for (const group of Object.values(groups)) {
    for (const name of group.node || []) declared.add(name);
    for (const name of group.tests || []) declared.add(name.replace(/^scripts\/tests\//, ''));
  }
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const command of Object.values(packageInfo.scripts || {})) {
    for (const match of command.matchAll(/scripts\/tests\/([\w./-]+)/g)) declared.add(match[1]);
  }
  return declared;
}

function checkSuiteCoverage() {
  const declared = declaredSuites();
  const unlisted = suiteFiles().filter(name =>
    !declared.has(name) && !SUPPORT_FILES.has(name) && !MANUAL_ONLY.has(name));
  if (unlisted.length) {
    console.error('\n这些套件既不在默认门禁、也不在 package.json 的按需入口，更没有登记为手动：');
    for (const name of unlisted) console.error(`  scripts/tests/${name}`);
    console.error('接进 checks.mjs 的一个组、加一条 npm 脚本，或写进 checks.mjs 的 MANUAL_ONLY。');
    return false;
  }
  console.log(`套件覆盖：${suiteFiles().length} 个文件全部有归属`
    + `（当前组 ${mode}：${(groups[mode].node || []).length} 个 Node + `
    + `${(groups[mode].tests || []).length} 个 --test）`);
  return true;
}

/** `npm test` 这一串能摸到的脚本名（传递闭包）。用来回答一个问题：「CI 到底跑不跑它？」 */
function scriptsReachableFromTest() {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {};
  const reachable = new Set(['test']);
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...reachable]) {
      for (const match of (scripts[name] || '').matchAll(/npm run ([\w:-]+)/g)) {
        if (!reachable.has(match[1])) { reachable.add(match[1]); grew = true; }
      }
    }
  }
  return { scripts, reachable };
}

/** 只在按需入口上、而 `npm test` 摸不到的那些套件——**CI 一个都不会跑它们**。
    这条判据是算出来的而不是列出来的：新加一个按需入口，它自动进这张网。 */
function unreachableSuites() {
  const { scripts, reachable } = scriptsReachableFromTest();
  const inGroups = new Set(Object.values(groups).flatMap(group =>
    [...(group.node || []), ...(group.tests || [])].map(name => name.replace(/^scripts\/tests\//, ''))));
  const reached = new Set();
  for (const name of reachable) {
    for (const match of (scripts[name] || '').matchAll(/scripts\/tests\/([\w./-]+)/g)) reached.add(match[1]);
  }
  return suiteFiles().filter(name =>
    !inGroups.has(name) && !reached.has(name) && !SUPPORT_FILES.has(name) && !MANUAL_ONLY.has(name));
}

/** 这个文件解析得过吗？`node --check` 只解析、不执行，所以拿它问任何文件都没有副作用。
    解析不过就回一小段错误（够指到行列），过得去回 null。**批量那条路的退路**，见 `parseFailures`。 */
function parseError(absolutePath) {
  const result = spawnSync(process.execPath, ['--check', absolutePath], { windowsHide: true, encoding: 'utf8' });
  if (result.status === 0) return null;
  return (result.stderr || '').trim().split('\n').slice(0, 5).join('\n');
}

/* 一个进程问完所有文件：`vm.SourceTextModule` 只解析、不求值，102 个文件约 100ms。
   逐个 `node --check` 是同一件事但每个文件一次进程启动（102 个约 5s）——而 `npm test`
   会走两遍这里（core 与 --static），那个差价不能不当回事。 */
const BATCH_PARSE = `
const fs = require('node:fs');
const vm = require('node:vm');
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const bad = [];
for (const file of files) {
  try { new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file }); }
  catch (error) { bad.push([file, String(error.message).split('\\n')[0]]); }
}
process.stdout.write(JSON.stringify(bad));
`;

/** 哪些文件解析不过：`Map<绝对路径, 一句话原因>`（全过就是空 Map）。

    批量那条路走不通时（比如哪天 `--experimental-vm-modules` 这个开关变了）退回逐个
    `node --check`——**两条路必须得出同一个结论**，否则判据自己就成了待观察的变量。
    反证在 `selfCheckGate`：同一对输入喂给这里，必须仍然分得清好坏。 */
function parseFailures(files) {
  if (files.length > 0) {
    const batch = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', BATCH_PARSE],
      { input: JSON.stringify(files), encoding: 'utf8', windowsHide: true });
    if (batch.status === 0 && batch.stdout) {
      try { return new Map(JSON.parse(batch.stdout)); } catch { /* 落到逐个检查 */ }
    }
  }
  const failures = new Map();
  for (const file of files) {
    const error = parseError(file);
    if (error) failures.set(file, error.split('\n').slice(0, 2).join(' '));
  }
  return failures;
}

/** 读 `node:test` 的汇总行。没有汇总行（不是 node:test 套件）时 `tests` 回 null——
    报 0 会让调用方把「没跑」当成「跑了 0 条」，而这两件事要分开。 */
function summarizeTestRun(output) {
  const read = key => {
    const match = new RegExp(`^ℹ ${key} (\\d+)$`, 'm').exec(output);
    return match ? Number(match[1]) : null;
  };
  const tests = read('tests');
  return { tests, fail: tests === null ? null : (read('fail') ?? 0) };
}

/**
 * 套件的**存活**：光有归属不够，还得证明它跑得起来。
 *
 * 这条堵的是两次真实事故，两条都发生在「按需入口」上、都几周无人发现：
 *   · `test_dsh_runtime.mjs` 是一个语法错误（多余的 `}));`）→ 解析阶段就死，贡献 0 行覆盖；
 *   · `test_dsh_plugin_cli.mjs` import 了一个已删除的 `findPython` → 模块载入阶段就死，
 *     而它的入口参数早就不在任何文档里，连「按 README 走一遍」都跑不到。
 *
 * 两条断言：
 *   · 解析：只解析、不执行，没有副作用；
 *   · 未设宿主环境变量空跑一次：退出码必须是 0 或 3（`EXIT_SKIP`），且真跑过就 `fail` 为 0、
 *     注册过至少一条测试——**空跑到「没跑过也不知道」正是要堵的形态**。
 *
 * 为什么只查「当前组之外」：当前组的文件马上会被真的跑一遍，语法错误当场就炸；
 * 这里要照亮的是今晚没人跑的那半边。代价约 0.3s，且随模式自适应
 * （CI 跑 core，于是 31 个非 core 文件被解析一遍；`--static` 时是 79 个；`--browser` 时反过来）。
 */
function checkSuiteLiveness() {
  /* 组里两种写法的前缀不一样：`node` 那半边本来就是相对 `scripts/tests/` 的
     （`browser/reading_test.mjs`），`tests` 那半边带完整前缀——两边都要归一化，
     否则「当前组之外」会变成「全部」，把当前组自己解析一遍（且失去自适应的意义）。 */
  const inGroup = new Set([...(groups[mode].node || []), ...(groups[mode].tests || [])]
    .map(name => name.replace(/^scripts\/tests\//, '')));
  const outside = suiteFiles().filter(name => !inGroup.has(name));
  const problems = [];

  const broken = parseFailures(outside.map(name => path.join(root, 'scripts', 'tests', name)));
  for (const [absolute, reason] of broken) {
    problems.push(`scripts/tests/${path.relative(path.join(root, 'scripts', 'tests'), absolute)} 解析不过`
      + `（当前组 ${mode} 不会跑它，所以只有这里能看见）：${reason}`);
  }

  const onDemand = unreachableSuites();
  for (const file of onDemand) {
    const result = spawnSync(process.execPath, ['--test', path.join(root, 'scripts', 'tests', file)], {
      windowsHide: true, encoding: 'utf8',
      // 把宿主环境变量清掉：有真宿主时这套跑的是另一条更重的路，这里只问「载不载得进来」。
      env: { ...process.env, STUDYMATE_DSH_PACKAGE: '', STUDYMATE_DSH_DOWNGRADE_PACKAGE: '' },
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.status !== 0 && result.status !== 3) {
      problems.push(`scripts/tests/${file} 空跑起不来（退出码 ${result.status}，期望 0 或 3）：\n`
        + `${output.trim().split('\n').slice(0, 6).join('\n')}`);
      continue;
    }
    const { tests, fail } = summarizeTestRun(output);
    if (tests === null) continue;                       // 不是 node:test 汇总（例如纯脚本），不猜
    if (fail !== 0) problems.push(`scripts/tests/${file} 空跑里有 ${fail} 条失败`);
    else if (tests < 1) problems.push(`scripts/tests/${file} 空跑一条测试都没注册`);
  }

  if (problems.length) {
    console.error('\n套件存活检查没过：');
    for (const problem of problems) console.error(`\n${problem}`);
    console.error('\n这些套件不在当前门禁组里，所以只有这一条断言能看见它们。');
    return false;
  }
  console.log(`套件存活：当前组之外 ${outside.length} 个文件都解析得过`
    + `；按需入口上 ${onDemand.length} 个套件空跑都起得来（${onDemand.join('、')}）`);
  return true;
}

/**
 * 反证：**上面两条判据本身还张着**。
 *
 * 只断言「真实套件都过」的话，判据哪天退化成恒真也照样绿——`test_architecture_boundaries.mjs`
 * 拿合成图钉住自己那张网，是同一条纪律。这里更便宜：两条判据都收成了纯函数，直接喂坏输入。
 * 每次门禁都跑，约 40ms。
 */
function selfCheckGate() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'studymate-gate-self-'));
  try {
    /* 一次同时喂好、坏两个文件：判据必须**两个方向都对**——坏的报出来，好的放过。
       只验「坏的报出来」的话，一个恒报错的判据也能过，门禁会永远红。 */
    const bad = path.join(scratch, 'syntax-error.mjs');
    fs.writeFileSync(bad, 'export const oops = }));\n');
    const good = path.join(scratch, 'fine.mjs');
    fs.writeFileSync(good, 'export const ok = 1;\n');

    const verdict = parseFailures([good, bad]);
    if (!verdict.has(bad)) throw new Error('反证失败：故意的语法错误没被判据抓出来');
    if (verdict.has(good)) throw new Error(`反证失败：一个合法文件被判成解析不过（${verdict.get(good)}）`);
    if (parseFailures([]).size !== 0) throw new Error('反证失败：空输入却报出了失败');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const sample = 'ℹ tests 4\nℹ pass 0\nℹ fail 0\nℹ skipped 4\n';
  if (summarizeTestRun(sample).tests !== 4 || summarizeTestRun(sample).fail !== 0) {
    throw new Error('反证失败：node:test 汇总行读不出来');
  }
  if (summarizeTestRun('ℹ tests 4\nℹ fail 2\n').fail !== 2) {
    throw new Error('反证失败：失败条数读不出来');
  }
  if (summarizeTestRun('not a test run').tests !== null) {
    throw new Error('反证失败：没有汇总行却报出了一个测试数');
  }
}

const groups = {
  core: {
    tests: [
      'scripts/release/release.test.mjs',
      // #83 拆除：预设注册的 TS 替代（形状逐字段一致）与 Codex 交互断点的 Node 移植。
      // 两条都是「原 Python 套件的验收面」，不是新功能——见脚本自己的文件头。
      'scripts/tests/test_preset_install.mjs',
      'scripts/tests/test_interaction_state.mjs',
      // Host 半数据层的特征化测试（lib/{workspace,library,assets,yaml,reference,attempts}.ts）
      'scripts/tests/test_host_library_payload.mjs',
      'scripts/tests/test_host_reference_fence.mjs',
      'scripts/tests/test_host_path_boundary.mjs',
      // 路径包含判据本身（lib/paths.ts）：reference / assets / export / lab 四处共用的那一份，
      // 边界值（同前缀兄弟目录、root 带尾分隔符、软链指出去、断链）逐条钉住。特征化测试测的
      // 是「取址/落盘的结果」，判据换一种写法照样可能绿——所以判据自己也要有一条。
      'scripts/tests/test_host_paths.mjs',
      // 阅读端 /api/studymate/* 路由的**错误信封**：形状（`{ok:false, error:{code,message}}`）、
      // 机读码词表（源码里用了表外的码就红）、以及两端一致（lib/client.js 是手写 JS，不进 tsc）。
      'scripts/tests/test_host_route_envelope.mjs',
      // 性能预算（目标态规格 §10.3）：**相对规模的比例**，不写绝对秒数。数 readLibrary()
      // 真的碰了几次文件系统，断言 4 倍规模 ≈ 4 倍工作量（线性 ≈ 4、平方 ≈ 16）。
      'scripts/tests/test_host_perf_budget.mjs',
      'scripts/tests/test_host_yaml_workspace.mjs',
      // #71 的验收面：作答数据的幂等/版本栅栏，以及「拿一份 v0.2 真实工作区跑一遍」
      'scripts/tests/test_host_attempts_fence.mjs',
      'scripts/tests/test_host_v02_workspace.mjs',
      // #72 的 Host 半：POST /api/studymate/attempts 的路由注册、请求体与状态码映射、
      // 「POST 落盘 → 另起一次读仍带得回上次选了 X」（跨请求 = 刷新页面那条）、
      // 冲突拒绝不写盘、主观题自评落盘、题库逐字不变。
      'scripts/tests/test_host_attempts_route.mjs',
      // 另外两条**写**路由的 Host 半（「三条写入路径」的其余两条）：
      // POST /api/studymate/progress —— 读完即学完的文本手术式状态写入（注释与笔记一字不动、
      // 幂等台账、版本栅栏、冲突不落盘）；POST /api/studymate/open —— 用本机默认程序打开
      // 参考资料 / 在文件管理器里选中（科目 slug 单段、resolve 后前缀比对、realpath 复核、
      // 逐平台命令）。两条都是「越权写 / 越权开」的反证比正例更重要。
      'scripts/tests/test_host_progress_route.mjs',
      'scripts/tests/test_host_open_route.mjs',
      // 纯函数域 lib/core/**：内容格式的解析与锚点题库对账（格式只有一个真相）
      'scripts/tests/test_core_format.mjs',
      'scripts/tests/test_core_anchors.mjs',
      'scripts/tests/test_core_lesson.mjs',
      // 纯函数域（lib/core/**）：JSON Schema 子集校验器 + 四类校验 + 规则层。
      // 最后一条是覆盖率下限门禁，它自己会 spawn 一轮带阈值的 `node --test`。
      'scripts/tests/test_core_schema_subset.mjs',
      // 纯函数域（`lib/core/memory.ts`，#190）：两份记忆的文本 → 可注入的画像三节投影、
      // `积累` 条目的键与内容、缺节与空骨架的判定。「`积累` 不进上下文」在这条套件里被钉成判据。
      'scripts/tests/test_core_memory.mjs',
      'scripts/tests/test_validators_curriculum.mjs',
      'scripts/tests/test_validators_progress_subject.mjs',
      'scripts/tests/test_validators_handoff.mjs',
      'scripts/tests/test_rules_pure.mjs',
      // 纯函数域的判据：写入栅栏（幂等台账 + 版本比较）、题库题型与字段、误解字段定型。
      // #107 退役了「问答面板的请求体」那一半（`test_core_ask_context.mjs` 随 `lib/core/ask.ts` 一起走）。
      'scripts/tests/test_core_fence_questions.mjs',
      'scripts/tests/test_core_coverage_floor.mjs',
      // 阅读端（lib/client.js）的契约：token 对比度达 WCAG AA（亮暗两套）、
      // 动效四档与 prefers-reduced-motion、首次引导定位几何（纯函数，node:vm 里跑）
      // 排版那一层（#89）：token 与「字号行高成套」的静态判据（配对齐全、行高无单位数、
      // 12px 以上必须引阶梯、正文那批选择器只许引 --smb-fs-body、窄档覆盖写在基础规则之后、
      // 面包屑宽度按全角字算）。
      'scripts/tests/test_client_tokens.mjs',
      'scripts/tests/test_client_typography.mjs',
      // 规范《阅读端呈现》§九 取值纪律 / §十 交互与可调项：标题阶梯、字重与圆角的允许集、
      // 正文列测宽引变量（写死 px 就是「拖了等于没拖」）、正文列**左右两条边各一个**抓手且
      // 都不探出正文列（探出去一格筛出横向滚动条）、左栏四个面板竖排、三处标题吸顶、
      // 小节条不换行、科目主页两栏。每条都做过注入违规的反证，会红。
      'scripts/tests/test_client_layout.mjs',
      // §十 B 的跟手 / 双击复位 / 持久化是**运行时行为**，静态读 CSS 读不出来——这一条只断
      // **源码形状**（rAF 逐帧合并、收手前补最后一帧、本地键、居中列两条边 ±2d、两个把手的
      // 角色与键盘可达），拦得住「哪次重构顺手删掉」，拦不住「合并写错了」。如实记着。
      'scripts/tests/test_client_drag.mjs',
      'scripts/tests/test_client_pure.mjs',
      // #88 三栏几何：ADR-0011 的让位顺序（右栏先拿 / 左栏先让 / 中栏保底 420）与
      // 「并排装不下就把那一栏盖在正文上」的降级。同样是纯函数——「任何画布宽度下都
      // 有一栏打得开」是代数，浏览器里一条条试既慢又试不全。
      'scripts/tests/test_client_panes.mjs',
      // #76 阅读位置三级降级：lib/client.js 里那段纯数学内核（切源码标记求值，不需要浏览器）
      'scripts/tests/test_client_reading_position.mjs',
      // #77 交付物题的界面：代跑事实块只显示事实（命令 / 退出码 / 两条流 / 截断），
      // 界面文案里一个判决词都没有，入口只有一颗「跑一次」按钮且不点不跑。
      // 渲染函数在工厂闭包里，靠 fixtures/client_harness.mjs 的 React 桩调起来。
      'scripts/tests/test_client_lab_run.mjs',
      // #202：`::: related` 的 href 归到哪——「本科目的另一课」认哪几种写法、比不中怎么降级、
      // 渲染出来是 `<button data-node>` 还是 `target="_blank"` 的 `<a>`。判据是纯函数，渲染
      // 那半边用 client_harness.mjs 的 React 桩调 `Block`；真浏览器里点一下在
      // browser/related_links_test.mjs。
      'scripts/tests/test_client_related.mjs',
      // #175：判分要点（criteria）是共享字段——预测验证 / 交付物的展开面板也要显示它，
      // 开放题照旧两块。同一套夹具（client_harness.mjs）把 SubjectiveBody 逐题型调起来。
      'scripts/tests/test_client_quiz_fields.mjs',
      // #69：架构边界与依赖无环断言（扫真实 import 图，域规则表默认拒绝）
      'scripts/tests/test_architecture_boundaries.mjs',
      // 工具域 lib/tools/**（#68）：域声明与越权即抛、工作区摘要、四个校验器、两个改写工具。
      // 夹具在 scripts/tests/fixtures/tools.mjs —— `fixtures/` 目录被上面的遍历显式跳过。
      'scripts/tests/test_tools_guard.mjs',
      'scripts/tests/test_tools_context.mjs',
      'scripts/tests/test_tools_validate.mjs',
      'scripts/tests/test_tools_rewrite.mjs',
      // 工具 schema 的**宿主子集**：多一个关键字、或把 `type` 写成数组，整批工具在真宿主里
      // 注册不上（真发生过一次，而 test:dsh 的探针只按名字查九个学习工具、抓不住）。
      // 这条直接逐个走 schema，不看名字。
      'scripts/tests/test_tools_schema_subset.mjs',
      // 任务域 lib/tasks/**（#73）：六态状态机、owner 句柄与越权、durable 落盘的**跨进程**接上、
      // 五个 studymate_task_* 工具、阅读端的 GET /api/studymate/tasks。
      // 跨进程那一半的「进程 A」是夹具 scripts/tests/fixtures/tasks_producer.mjs。
      'scripts/tests/test_tasks_model.mjs',
      // 实验域 lib/lab/**（#77）：判分三轨的第三轨。真跑一条会失败的命令、真实输出原样进
      // 作答数据（attempts/*.json 的 `跑` 字段）、长命令的进度与取消回执、以及四组越界反证
      // （cwd / 可写范围 / 参数里的路径 / 软链）。命令从哪来也是断言的一部分：只有题库里那道
      // 交付物题的「证据」字段能提供命令，模型与学生都没有第二个入口。
      'scripts/tests/test_lab_runner.mjs',
      // 核验域 lib/reach/**（#125）：核「资源清单」里的链接。真 loopback HTTP 服务器当目标站与
      // 代理（不发一个到仓外的请求）：计数与失败清单、全局并发 ≤8 且同站不并发、第二遍零请求、
      // 离线不开 socket、墙上预算到点交回去再调一次能接着做完、路由表只探一次（直连失败换代理）。
      // 纯函数那一半（清单摘链接、按 URL 去重、1 起行号）也在里面。
      'scripts/tests/test_reach_verify.mjs',
      // 阅读端（lib/client.js 是零构建的浏览器插件，没有 export）：跨科目搜索的索引覆盖与
      // 四个附件折叠块的空态。套件在 Node 里伪造 window.__ModuleLoader__ + react 桩把头文件
      // 跑掉，再断言工厂闭包里的纯逻辑与渲染函数（夹具见 scripts/tests/fixtures/client_harness.mjs）。
      'scripts/tests/test_client_search_index.mjs',
      'scripts/tests/test_client_fold_empty_state.mjs',
      // #222：一门科目的文件读不了时，主页点名是哪门、哪份文件第几行，好科目照常列——
      // 不是整页一张「读不到学习工作区」。数据侧按科目隔离在 test_host_library_payload.mjs。
      'scripts/tests/test_client_unreadable.mjs',
      // #72 的 Client 半：作答落盘的写队列 + 合并轮询 + 陈旧响应围栏（旧读数/在飞写入
      // 不许覆盖新作答）、版本冲突的重读与重来一次、自评走同一条路、界面文案不再说
      // 「只在内存里作答」。夹具同上（client_harness.mjs）。
      'scripts/tests/test_client_attempt_fence.mjs',
      // #105/#79：问答面板不再自己调模型，它请宿主半建一条真会话——面板那一半在 Node 里点
      // 它的按钮、看它发的 POST（fetch 是假货）；Host 那一半改了策略：旧路由与旧上下文组装
      // 已由 #107 退役，`test_host_ask_route.mjs` 随之删除。
      'scripts/tests/test_client_ask_panel.mjs',
      // #105：问答面板改成宿主的一条真会话。建会话只能走宿主半（客户端 sessions.create 把
      // agentPreset 静默丢掉），所以这条钉的是「按答疑预设建、带 cwd、标题拼法与识别、共享
      // 记忆只注入一次、没有模型就不建会话」。先例同上（假 ctx）。
      'scripts/tests/test_host_ask_session.mjs',
      // #107 的验收面（三条硬事实）：旧路由没注册（登记表 + 请求它是明确的 404）、客户端里
      // 没有发往旧路由的 POST 与那份上下文组装、新会话链路跑一遍工作区逐字节不变且其余
      // 写入方（讲解反馈）照旧写得进去。
      'scripts/tests/test_ask_retirement.mjs',
      // #92：选中正文冻成一条**留得住的引用**（文本 + 来源锚点）。捕获那一下的判据在 Node 里
      // 用假 DOM 逐个喂（含各种「读到空选区」的触发方式，都不得清掉已存在的引用）。真鼠标拖拽
      // 那一条在 --browser 组。
      'scripts/tests/test_client_ask_quote.mjs',
      // #106：引用 chip（选中那段跟着**下一条消息**走）。`ref` 是字符串、没有反序列化入口，
      // 所以「原文 + 来源锚点」的编解码 / `serialize` / `clipboardText` 是一对纯函数；引用来源
      // 「插件激活时注册、卸载时注销」是承重的（提交那一刻找不到 owner 会让整次发送失败），
      // 插入/换掉/撤掉那条调用序列用假输入门面（occurrences + draftRev CAS）逐条钉住。
      'scripts/tests/test_client_ask_chip.mjs',
      // 监听域 lib/watch/**（#74）：变更通知的形状与域映射（纯）、目录集合监听（真 fs）、
      // 两条推送路（真 HTTP，bridge 与宿主同形）、阅读端「未变即同引用」（VM 里跑 lib/client.js）。
      // 真 DSH 里的端到端在 scripts/tests/test_dsh_runtime.mjs 的监听探针里。
      'scripts/tests/test_watch_notice.mjs',
      'scripts/tests/test_watch_tree.mjs',
      'scripts/tests/test_watch_push.mjs',
      'scripts/tests/test_watch_client.mjs',
      // 导出域 lib/export/**（#82）：产物形状与取消语义、泄漏守卫（含反证：注入 Node 专用依赖
      // 必须让构建失败）、工具面与任务模型（DSH 侧不主动导出、取消回执说清保留什么）、
      // 无头侧的 CLI（没有参数也能跑 = 「课完默认导一份」）。
      // 浏览器那一半（file:// 下真渲染）在 --browser 组。
      'scripts/tests/test_export_static_page.mjs',
      'scripts/tests/test_export_leak_guard.mjs',
      'scripts/tests/test_export_tool_task.mjs',
      'scripts/tests/test_export_cli.mjs',
      // #91 的 Host 半：随包发的 KaTeX dist（CSS ↔ 字体的双向对账、版本对账、精确 MIME）
      // 与它的投送路由（一条文件一条精确路由、路径落在 /api 之内、取址判据）。
      // 阅读端那一半（题库字段只接数学式、降级可读）在 test_client_math.mjs；
      // 真浏览器里「按需加载 → 排版成功」在 --browser 组的 browser/math_test.mjs。
      'scripts/tests/test_host_math_route.mjs',
      'scripts/tests/test_client_math.mjs',
      // #87 的验收面：技能与工具的**可见边界**。出方向（别的预设扫不到 StudyMate 的
      // 技能）、入方向（学习预设显式声明的技能目录在包内）各一条，外加一条把
      // 「工具/面板仍在 profile 根注册」这个与 spec 的已知偏离钉成事实的特征化断言。
      'scripts/tests/test_skill_visibility.mjs',
      // #104 的验收面：「答疑模式」预设与只读取课件工具。预设的形状（与学习模式并列、
      // 插件行最小面、技能目录只含 local-qa）、工具面收窄（deny 掉 profile 根的全部原生工具、
      // 只读工具进本作用域）、只读工具的外部行为（给得出正文与题 / 给得出「没有」/ 不写盘）
      // 与占位符守卫。真宿主认不认这条配置只在真 DSH 里证得了——那一条不进默认门禁。
      'scripts/tests/test_host_qa_preset.mjs',
    ],
  },
  '--static': {
    tests: ['scripts/tests/test_openai_skills.mjs', 'scripts/tests/test_openai_skill_ui.mjs', 'scripts/tests/test_antigravity_skills.mjs',
      // #81：技能调用面 ↔ lib/tools 注册表对账（点名的工具必须存在；无头宿主导出件里
      // 不许留原生工具名，也不许留宿主跑不动的调用）。
      'scripts/tests/test_skill_contracts.mjs',
      // #83：原四份 Python 套件的**行为移植**（技能规则、技能调用面、词表、发布元数据）——它们守的东西一件都没退役（提示词规则仍在
      // 那些技能里、调用面仍分角色、三档词表仍在 schema 里、发布元数据仍要与 tag 对齐）。
      'scripts/tests/test_skill_rules.mjs',
      // 讲法体检（`preset/skills/lesson-design/SKILL.md` §三 六条判据的分辨力）：起笔是概括还是
      // 具体、末段回没回收起笔的疑问、4000 字复核线、标题写「N 个东西并列」、一段里符号超三个
      // 且还没做过计算、类比没有断点声明。工具在 `scripts/tools/lesson-style-check.mjs`，
      // 出的是**非阻断提醒**（与学生看到的课件质量线同级），这条套件只钉「它报得对不对」。
      'scripts/tests/test_lesson_style.mjs',
      // 闭卷卷子与判分键的骨架（`templates/closed-book/`）：五个部分的名字与配分、两条判定线、
      // 「只看产物不看自评」、三条局限、以及「模型不代答」。钉的是**结构不是措辞**——这些改了
      // 就等于换了一把尺子，两次的分数不可比。用法在 `layered-practice` §八。
      // 正文可理解性的七个指标（`scripts/tools/lesson-readability.mjs`）：连贯空缺率、拟物动词、
      // 定语嵌套、就近整合、句长、路标、衔接词。**分数是批内分位，不是绝对分**——实测 23 份课件
      // 的连贯空缺率全部落在 31–60%，写死绝对阈值等于没分辨力。这条套件只钉「它报得对不对」，
      // 每条判据都有正例不报、反例必报的一对样例（实测抓到过三处：二元组饱和、名词连缀误报、
      // 把「决定」当拟物动词）。
      'scripts/tests/test_lesson_readability.mjs',      // 闭卷卷子的**配分算术**：小问加起来必须等于大题满分。配分是量具的一部分，
      // 错一分两次分数就不可比，而错法（小问多一分少一分）肉眼看不出来。
      // 它还审工作区里的真卷子——CI 上没有工作区就跳过，不当失败。
      // 评分者一致性（`scripts/tools/rater-agreement.mjs`）：ICC(2,k) 与 Krippendorff α。
      // 这是「判分键能不能用」的唯一凭据。第一版 ICC 漏了一步归一，跑出 49.5（ICC 不可能
      // 大于 1）——一个越界但"看起来像个数"的值比报错危险得多，所以工具现在越界就拒绝给值，
      // 这条套件钉住这一点。
      // 学习方法层的**结论索引**（`docs/设计/学习方法层-结论索引.md`）必须与代码一致：
      // 表里提到的每个 `npm run <名字>` 要在 package.json 里存在、点名的仓库路径要在盘上、
      // 半宽数值要与 bootstrap 脚本现算的一致。写错的样子很难看出来——「改名的脚本」「换了参数的
      // 半宽」都"看着像真的"。实测抓到过一次：索引写 14–19 分，现算是 6.3–18.8（漏了"几乎全对"
      // 那档 6.3），改完又发现判分键里同一个数也漏了这一档。
      // 背默卡的计分与闸门（`scripts/tools/recite-score.mjs`）：S1 命题召回 + S2 结构档 + 迁移探针，
      // 三条闸门缺一不算通过、「字面搬运」S2=0 时 S1 再高也不过。**还有一条最要紧的**：
      // 10 条要点、S1=0.8 时 bootstrap 半宽是 0.25——0.8 这条闸门线根本分辨不了 0.65 与 0.95。
      // 判分键里那张「要点数 → 半宽」的表由这条套件现算比对，写错会红。
      // 背默卡的**要点表**必须与课件对得上（`test_recite_card.mjs`）：数量 ≥15、三类齐、
      // 每条是可判真假的断言、关键数字按完整边界匹配课件原文。最后一条是真踩到的——
      // 编造的「4.2 nA」曾被判成"在课件里"，因为它命中了「74.2 mm」与「4.21°」。
      // **判分键与要点表绝不能落进阅读端可读的目录**（`test_no_answer_leak.mjs`）。
      // 2026-11-15 我自己差点泄了：为了让卷子一键能打开，把卷子/判分键/背默卡一起拷进了
      // `reference/`——阅读端会把它们列进「参考资料」，学生打开就看见答案。
      // `assessments/` 阅读端不认识，那正是判分键唯一的防线。
      // 判分键的**共用段落**必须与骨架一致（`scripts/tools/sync-key-common.mjs --check`）：
      // 背默卡计分那一整节在骨架里只有一处定义。前十四轮我改过骨架三次，**每一次真判分键
      // 都停在旧内容上**——模板对了、成品没跟上，等于没改。
      'scripts/tests/test_key_common_sync.mjs',      'scripts/tests/test_no_answer_leak.mjs',      'scripts/tests/test_recite_card.mjs',      // **闸门线本身不可判**（`scripts/tools/gate-resolvability.mjs`）：相邻两档只差 1/n，而区间
      // 宽度是 O(1/√n)——重叠会缩小但不归零。实测 18 点重叠 0.277、60 点 0.183、400 点 0.071。
      // 所以「S1 ≥ 0.8」在任何要点数下都不是可判的判决；判分键里那张表由这条套件现算比对。
      // 第一版把作答参数传成 `{}`，区间全是 [0,0]，整张表成了「全都可判」的假象。
      // **引文必须能追到原话**（`test_citation_provenance.mjs`）：规范里引的每个「作者 年份」都要在
      // `docs/取证/` 里有出处，已读的要带原话，未核的进「尚未核过」那张表。
      // 2026-11-15 第一次跑它就红了——结论索引引了 Karpicke / Roediger，而取证目录里
      // 只有讲法四份、一条学习科学文献都没有。**前十七轮的文献支撑，在仓库内是断的。**
      // 自己核原文时还抓出一处真错：卷子把 Cepeda 2008 在 35 天保持期上的最优间隔写成 7 与 30，
      // 原文是 11 天。
      // **待定的拍不许悄悄进规范**（`test_pending_beats.mjs`）：设计文档的节拍表有六拍，
      // 但只有 B0/B2/B3/B8 落进了 `layered-practice`。查清原因后这个状态是对的——B5（交错）
      // 与 B6（延迟反馈）的证据互相打架、且都没自己核过原文，所以没落。
      // 这条套件守住：待定的必须标「证据打架」、已落的四拍必须在规范里、
      // 待定的不许被写成可执行规则。
      // **报分必须带的东西，一件都不许省**（`test_inspection_record.mjs`）：报分的规矩散在
      // `layered-practice` 的七八处（带区间、三条局限、判定带只是报告用语、剖面比总分稳、
      // 拿不准的题要写出来），**之前没有一份成品把它们一次落全**。
      // 学生答完题最可能发生的事就是：评分者只报一个总分——而那个总分的半宽是 6–19 分。
      // **从手写判定表直接算 S1**（`recite-from-table.mjs`）：`recite-score.mjs` 要 JSON，
      // 而判分者手上是一张「P1 命中 / P6 部分」的表。中间转一手编 JSON，是填报分单最容易
      // 放弃的地方。这个工具直接吃那张表。
      // 它自己踩过三个坑，全在写的时候一次犯完：`|` 开头被当跳过、只按制表符切（`P1 命中`
      // 全丢，8 行表解析出 1 条）、`--s2 2` 里的 2 被当成文件名。**三个坑都不报错，只是算错。**
      // **从要点表生成空白判分表**（`recite-sheet.mjs`）：判 18 条要点时，判分者手上应该已经有
      // 一张表，而不是自己从头画——画表没有判断成分，纯粹体力活，而体力活正是让人放弃的地方。
      // 这条套件钉住最关键的一点：**生成的表能被 `recite-from-table` 读回去**。
      // 第一版接不上（一个生成勾选框、一个只读第 2 格），填好的表喂进去一条都解析不出。
      // **端到端演练**（`test_recite_pipeline_e2e.mjs`）：卡 → 表 → 填 → 算 → 报分单，
      // 整条链真跑一遍。第二十四轮发现了「单件全绿、串起来全错」，这条套件就是防它复发。
      // 它抓到的三件事都是单件测试看不见的：闸门落在区间内时工具照样印「不通过」、
      // 区间算法把「部分」密化成整数条、报分单没说「做背默卡就删掉卷子那节」。
      // **使用说明里必须有「自己做一次检验」**（`test_usage_guide.mjs`）：前面二十六轮做的所有东西
      // （卷子 / 判分键 / 背默卡 / 检验记录 / 锚点数据集 / 五套工具）在 `docs/使用/使用说明.md`
      // 里**一个字都没有提到**。一个学生读完使用说明，不会知道「考考我」存在。
      // **没有使用说明，等于没做。**
      'scripts/tests/test_usage_guide.mjs',      'scripts/tests/test_recite_pipeline_e2e.mjs',      'scripts/tests/test_recite_sheet.mjs',      'scripts/tests/test_recite_from_table.mjs',      'scripts/tests/test_inspection_record.mjs',      'scripts/tests/test_pending_beats.mjs',      'scripts/tests/test_citation_provenance.mjs',      'scripts/tests/test_gate_resolvability.mjs',      'scripts/tests/test_recite_score.mjs',      'scripts/tests/test_methods_index.mjs',      'scripts/tests/test_rater_agreement.mjs',      'scripts/tests/test_closed_book_scoring.mjs',      'scripts/tests/test_closed_book_template.mjs',
      'scripts/tests/test_skill_frontmatter.mjs',
      'scripts/tests/test_statuses.mjs',
      'scripts/tests/test_release_metadata.mjs',
      // #83：文档悬空引用（README 与 docs/** 的相对链接、行内代码里的仓库路径）。
      // 拆除之后最容易留下的就是"文档还指着已删文件"，人眼扫不可靠。
      'scripts/tests/test_docs_references.mjs',
      // #189：共享记忆改名 `MEMORY.yaml`。**否定式**扫全仓「旧名一处都不许留」——
      // 规则可达性套件只断「必须出现」，钉不住「不许再出现」，改名这类横扫的残留
      //（某份夹具、某条注释、模板说明表里的旧路径）靠人眼扫不出来。
      'scripts/tests/test_memory_rename.mjs'],
  },
  '--browser': {
    // 三个旧静态模板夹具（hl / quiz_code / math）随 `templates/assets/` 一起退役：
    // 它们测的是「生成出来的页面 + 模板资源」，而页面已经不再预生成。它们守的渲染面
    // 由这三条接住——reading_test 测阅读端本体（真 lib/client.js），export_file_test
    // 测**导出的产物本身**在 file:// 下真渲染（样式、公式、图片、代码块、题目）。
    // 后面两条各测阅读端的一块，夹具同一套（harness.mjs + mini-react）：
    //   · #76 阅读位置三级恢复 + 锚点四态复核；
    //   · #72 作答落盘（把阅读端打进一个说 HTTP 的迷你宿主，真的落盘到工作区文件）。
    node: [
      'browser/reading_test.mjs',
      'browser/reading_position_test.mjs',
      'browser/attempts_test.mjs',
      // #74：真浏览器里「改文件 → 监听 → SSE → 页面自己更新（不刷新）」的端到端。
      // 其余几套测的是阅读端的静态面；这一套要的是**真的 EventSource**接我们那条流式 Response。
      'browser/watch_push_test.mjs',
      // #77：交付物题的「跑一次」——点一下 → 真命令跑起来 → 真实输出回到界面并落进
      // attempts/。夹具与 attempts_test.mjs 同一套（真 lib/client.js + 真 HTTP 迷你宿主），
      // 走的是 lib/lab/route.ts 注册出来的真路由。
      'browser/lab_run_test.mjs',
      // #82：**导出的产物本身**在 file:// 下打开（真 Chrome + 真 React）：样式、公式、图片、
      // 题目全部可用，且控制台/页面/失败请求干净。不搭夹具页——测的就是学生拿到的那份东西。
      // #91 换掉了里面那条**假绿**的公式断言（原来只匹配 TeX 原文），并加了「题面里的公式也排
      // 出来了」「KaTeX 字体真的加载了」两条。
      'browser/export_file_test.mjs',
      // #91：公式排版。夹具是一个说 HTTP 的迷你宿主，它按 lib/math-route.ts 注册出来的路由投送
      // **包里那份 KaTeX dist**，页面跑真 lib/client.js。五个场景：正文行内/块级公式排出来、
      // 公式只写在题面里也照样加载（判据把题库字段算进去）、没有数学式的页面零请求、
      // 资源缺失降级成可读 TeX、排版失败给一句明确的错。导出产物那一半在上面那条里（file://）。
      'browser/math_test.mjs',
      // #86：阅读端**四路由 × 三档视口**。上面那条 reading_test 恒定 1440×960，于是
      // lib/client.js 里两条 `@media (max-width: 900px)` 从来没被执行过；这一条把四个面
      // （今天学什么 / 科目主页 / 课件页 / 搜索）在宽窄两档各取一次景，亮暗两套的实测对比度
      // 与动效四档也在里面。窄档不是截图，是换 CSS 视口再跑一遍。
      // #88 加了紧档（700×900）与一场几何扫描：那一档课件页的右栏并排装不下，必须是
      // 「盖在正文上 + 说明 + 收起」的抽屉——「点题目没反应」正是那张票要消掉的缺陷。
      // #93 也落在这里：右栏题库的内部呈现——题型徽标是贴字的标签（不再被弹性行拉成竖条）、
      // 右栏 tab 用右栏那套下划线（不是左栏的胶囊）、点正文标记那一组是「当前」、上次作答的
      // 结果还在、长 token 折行而不是出横向滚动条。夹具另造一份：三种题型各一组、
      // 题干与选项里各一段没有断点的长 token、题库带着一次落盘的作答。
      'browser/reading_routes_test.mjs',
      // #89：课件页正文与页头的呈现——配图两条路（位图受列宽约束、矢量随列宽、暗色不刺眼）、
      // 代码块语言标签与块内横向滚动、长标识符/URL/宽表格不撑出横向滚动条、一屏一种正文字号、
      // 顶部只剩一条（课件标题 + 小节跳转）、面包屑按全角字省略、题目标记带组号。
      // 宽窄两档各一遍，每个场景一张截图。
      'browser/lesson_body_test.mjs',
      // #92：问答面板里那条引用的**真浏览器**用例。Node 里没有真选区，而这张票的病根恰恰
      // 出在「document 级 mouseup 读实时选区、判定失败就清空」——点输入框会让浏览器把选区
      // 折叠成空。所以这里用 CDP 的 Input.dispatchMouseEvent 做真鼠标拖拽（harness 没有
      // 选区/拖拽助手，套件自己补 dragSelect/clickAt），验「选中 → 打开问答 → 点输入框/打字/
      // 切 tab 之后引用仍在」。#106 起提交那段走引用来源的 codec（`ref` 原样进消息，不再是
      // 面板往请求体里塞原文），#107 退役了旧路由，这一套钉的就是 chip 那条真浏览器链路。
      'browser/ask_quote_test.mjs',
      // #202：「相关课件」指向本科目另一课时在阅读端里就地打开。Node 那边钉住了判据与元素形状
      // （test_client_related.mjs），这一条钉的是**点下去之后**：这一页换成那一课、地址一字不变
      // （没开新窗口）、写错的那一条点不动。夹具与 reading_routes_test 同一套。
      'browser/related_links_test.mjs',
    ],
  },
};
const mode = process.argv[2] || 'core';
if (process.argv.length > 3 || !Object.hasOwn(groups, mode)) {
  console.error('Usage: node scripts/release/checks.mjs [--static|--browser]');
  process.exit(2);
}

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
let failed = false;
function run(command, args) {
  console.log(`\n${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env },
  });
  if (result.error) console.error(result.error.message);
  failed ||= result.status !== 0;
}
if (!checkSuiteCoverage()) process.exit(2);
try {
  selfCheckGate();                                    // 先证明判据自己还张着，再拿它判真实套件
} catch (error) {
  console.error(`\n门禁自检没过：${error.message}`);
  process.exit(2);
}
if (!checkSuiteLiveness()) process.exit(2);

const group = groups[mode];
for (const file of group.node || []) run(process.execPath, [`scripts/tests/${file}`]);
if (group.tests?.length) run(process.execPath, ['--test', ...group.tests]);
process.exitCode = failed ? 1 : 0;
