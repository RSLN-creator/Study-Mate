/* 特征化测试：Host 半路由 · `POST /api/studymate/progress`（ADR-0015 的 Host 半）
   ────────────────────────────────────────────────────────────────────────
   纯函数域那一半（`读完` 这个推进事件）由 test_rules_pure.mjs 钉住；这里钉的是**阅读端真正打到
   的那一层**：路由怎么挂、请求体什么形状、状态码怎么映射、拒绝怎么说话，以及**保形写回**
   （只改 `nodes.<节点id>.status`，`notes`、注释、别的节点、换行风格一个都不许动）。

   验收标准逐条对应：
     1. **读完即「已学完」**：`学习中` / `未开始` 的节点都被置为「已学完」，另起一次
        `readLibrary`（= 浏览器刷新后那次 `GET /api/studymate/library`）看得到新状态与新版本号；
     2. **一个字段都不多改**：`notes`、行尾注释、`updated_at`、`project`、别的节点逐字不变
        （含 CRLF 文件：写回后仍是 CRLF）；
     3. **幂等**：重放同一个 operationId 不写第二遍（文件字节不变、回执相等）；
     4. **版本冲突**：`expectedVersion` 对不上就 409、不写盘、回当前版本号（阅读端据此重读）；
     5. **实验课不动**：`kind: 实验` 的节点读完不置位（它按验收结论置位），回 `changed:false`；
     6. **只认「读完」**：别的 event 一律 400 `event-invalid`（这条路不是通用进度写入口）。

   工作区在 fs.mkdtemp 造的临时 HOME 里现造现弃（ADR-0009：仓库里不存样例数据）。

   两处刻意的写法（与 test_host_attempts_route.mjs 同一条）：
     · `DSH_HOME` 指向临时目录——`resolveWorkspace()` 读的就是它，走真路径而不是给路由开后门；
     · 路由**通过 `registerProgressRoutes` 挂一遍再取出来调**，不是直接调 handler。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { PROGRESS_PATH, registerProgressRoutes } from '../../lib/progress-route.ts';
import { progressVersion, writeProgress } from '../../lib/progress.ts';
import { readLibrary } from '../../lib/library.ts';

/* ── 临时工作区：跑完即弃 ─────────────────────────────────────────────── */

const TEMPS = [];
after(() => {
  for (const dir of TEMPS) fs.rmSync(dir, { recursive: true, force: true });
});

const SUBJECT = 'demo';
const NODE = 'net.layers';        // 概念课，已在 progress.yaml 里（学习中）
const NEW_NODE = 'net.tcp';       // 概念课，只在 curriculum.yaml 里（= 未开始）
const LAB_NODE = 'net.lab';       // 实验课：读完不置位

/** 一份带注释、带 notes、带行尾注释的进度文件——保形的判据全在它身上。 */
function progressText() {
  return [
    '# 学习进度：运行期状态只写在这里（curriculum.yaml 的 status 是建课时的初始快照）。',
    'updated_at: "2026-09-24"',
    'nodes:',
    `  ${NODE}:`,
    '    status: 学习中   # 页内自测还没做完',
    '    notes: 记住了分层',
    `  ${LAB_NODE}:`,
    '    status: 学习中',
    'project:',
    '  current: ""',
    '',
  ].join('\n');
}

/** 一份最小科目 + 一份临时 HOME，并把 DSH_HOME 指过去（resolveWorkspace 只认这个）。 */
function makeHome({ progress = progressText(), eol = '\n' } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'studymate-progress-'));
  TEMPS.push(root);
  const home = path.join(root, 'dsh');
  const workspace = path.join(root, 'ws');
  const subjectDir = path.join(workspace, '.learning', 'subjects', SUBJECT);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(subjectDir, { recursive: true });
  fs.writeFileSync(path.join(home, 'studymate-config.yaml'), `workspace: ${JSON.stringify(workspace)}\n`);
  fs.writeFileSync(path.join(subjectDir, 'subject.yaml'), `slug: ${SUBJECT}\nname: 进度\n`);
  fs.writeFileSync(path.join(subjectDir, 'curriculum.yaml'), [
    'nodes:',
    `  - id: ${NODE}`,
    '    title: 分层',
    '    kind: 概念',
    `  - id: ${NEW_NODE}`,
    '    title: 传输',
    '    kind: 概念',
    `  - id: ${LAB_NODE}`,
    '    title: 分层实验',
    '    kind: 实验',
    '    prerequisites: [net.layers]',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(subjectDir, 'progress.yaml'), eol === '\n' ? progress : progress.replace(/\n/g, eol));
  return { root, home, workspace, subjectDir, progressFile: path.join(subjectDir, 'progress.yaml') };
}

/* ── 挂路由：模拟宿主的**两层** ctx（外层 `inject` → 注入后的 connection ctx）── */

function connect() {
  const routes = [];
  const labels = [];
  const child = {
    connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } },
    effect: (fn, label) => { labels.push(label); return fn(); },
  };
  const injections = [];
  const ctx = {
    inject: (names, handler) => { injections.push(names); handler(child); },
  };
  registerProgressRoutes(ctx);
  return { ctx, child, injections, routes, labels, route: routes[0] };
}

/** 一次 POST：路由注册出来的那个 handler 原样吃一个 Request（与宿主同一条路径）。 */
function post(route, body, init = {}) {
  return route.fetch(new Request('http://127.0.0.1' + PROGRESS_PATH, Object.assign({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, init)));
}

let seq = 0;
function op(name) {
  seq += 1;
  return `${name}-${process.pid}-${seq}`;
}

/** 一次完整的「读完」请求体：`expectedVersion` 默认取当前盘上的版本号。 */
function submission(workspace, overrides = {}) {
  return Object.assign({
    subject: SUBJECT,
    node: NODE,
    event: '读完',
    operationId: op('finish'),
    expectedVersion: progressVersion({ workspace, subject: SUBJECT }),
  }, overrides);
}

const tierOf = (workspace, node) =>
  readLibrary({ workspace }).subjects[0].nodes.find((item) => item.id === node).tier;

/* ── 注册 ─────────────────────────────────────────────────────────────── */

test('路由挂得上：路径、方法、请求体，以及缺 connection 时不炸', () => {
  const { routes, labels, injections } = connect();
  assert.equal(routes.length, 1);
  const [route] = routes;
  assert.equal(route.path, PROGRESS_PATH);
  assert.equal(route.path, '/api/studymate/progress');
  assert.deepEqual(route.methods, ['POST'], '只开写；读走 payload 的 node.tier 与 subject.progress_version');
  assert.equal(route.requestBody, 'buffered');
  assert.equal(typeof route.fetch, 'function');
  assert.deepEqual(labels, ['studymate: 读完进度路由'], '注册是有主的副作用（走 effect）');
  assert.deepEqual(injections, [['connection']]);

  // headless / 更老的宿主：没有 inject、或注入后缺 connection / effect 时**一条路由都不挂**，也绝不抛
  const nothing = [];
  assert.doesNotThrow(() => registerProgressRoutes(undefined));
  assert.doesNotThrow(() => registerProgressRoutes(null));
  assert.doesNotThrow(() => registerProgressRoutes({}));
  assert.doesNotThrow(() => registerProgressRoutes({ inject: (names, handler) => handler({}) }));
  assert.doesNotThrow(() => registerProgressRoutes({
    inject: (names, handler) => handler({ connection: {}, effect: () => {} }),
  }));
  assert.doesNotThrow(() => registerProgressRoutes({
    inject: (names, handler) => handler({ connection: { fetch: { register: (route) => nothing.push(route) } } }),
  }));
  assert.deepEqual(nothing, [], '缺 effect 时不许注册');
});

/* ── 1. 读完即已学完 + 保形 ───────────────────────────────────────────── */

test('POST 读完：状态置「已学完」，回执逐字段，另起一次读（= 刷新页面）看得到', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const before = readLibrary({ workspace }).subjects[0];
  assert.equal(before.nodes.find((item) => item.id === NODE).tier, '学习中');
  assert.equal(before.nodes.find((item) => item.id === NODE).notes, '记住了分层');
  assert.match(before.progress_version, /^[0-9a-f]{16}$/, 'payload 要带上写入端算得出来的版本号');

  const bytes = fs.readFileSync(progressFile);
  const response = await post(route, submission(workspace));
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(),
    ['changed', 'node', 'ok', 'progress', 'reason', 'tier', 'version'].sort(),
    '回执字段是与阅读端约定的那一组，不多不少');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.node, NODE);
  assert.equal(receipt.tier, '已学完');
  assert.equal(receipt.changed, true);
  assert.match(receipt.reason, /读完：学习中 → 已学完（学生通读到末尾，是事实、不是自评）/);
  assert.equal(receipt.progress, `.learning/subjects/${SUBJECT}/progress.yaml`);
  assert.match(receipt.version, /^[0-9a-f]{16}$/);
  assert.notEqual(receipt.version, before.progress_version, '写完版本号要换一个：它就是下一次的栅栏');
  assert.notDeepEqual(fs.readFileSync(progressFile), bytes, '这次真的写了盘');

  // 保形：只动 status 那一行的值；notes、行尾注释、updated_at、project、别的节点逐字不变
  const after = fs.readFileSync(progressFile, 'utf8');
  assert.equal(after, progressText().replace('status: 学习中   # 页内自测还没做完', 'status: 已学完   # 页内自测还没做完'),
    '写回只该改这一个字段（别的键、注释、行序、行尾注释都原样）');

  // **跨请求**：这是浏览器刷新后真正走的读路径（GET /api/studymate/library → readLibrary）
  const refreshed = readLibrary({ workspace }).subjects[0];
  assert.equal(refreshed.nodes.find((item) => item.id === NODE).tier, '已学完');
  assert.equal(refreshed.nodes.find((item) => item.id === NODE).notes, '记住了分层');
  assert.equal(refreshed.progress_version, receipt.version, 'payload 的版本号与回执同源');
});

test('节点不在 progress.yaml（= 未开始）→ 在 nodes 块末尾追加一块，别的节点不动', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const response = await post(route, submission(workspace, { node: NEW_NODE }));
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.tier, '已学完');
  assert.equal(receipt.changed, true);
  assert.match(receipt.reason, /读完：未开始 → 已学完/);

  const after = fs.readFileSync(progressFile, 'utf8');
  assert.match(after, /  net\.tcp:\n    status: 已学完\n/);
  assert.match(after, /  net\.layers:\n    status: 学习中   # 页内自测还没做完\n    notes: 记住了分层\n/,
    '原有节点一字不动');
  assert.match(after, /project:\n  current: ""\n$/, 'project 还在原来的位置（新块插在 nodes 块里）');
  assert.equal(readLibrary({ workspace }).subjects[0].nodes.find((item) => item.id === NEW_NODE).tier, '已学完');
});

test('`nodes: {}`（建课时的空写法）也能写：先展开成块再追加', async () => {
  const { home, workspace, progressFile } = makeHome({
    progress: ['updated_at: "2026-09-24"', 'nodes: {}', 'project:', '  current: ""', ''].join('\n'),
  });
  process.env.DSH_HOME = home;
  const { route } = connect();

  const response = await post(route, submission(workspace, { node: NODE }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tier, '已学完');
  const after = fs.readFileSync(progressFile, 'utf8');
  assert.equal(after, [
    'updated_at: "2026-09-24"',
    'nodes:',
    `  ${NODE}:`,
    '    status: 已学完',
    'project:',
    '  current: ""',
    '',
  ].join('\n'));
});

test('节点在文件里但缺 status 行：按兄弟行的缩进补一行，notes 不动', async () => {
  const { home, workspace, progressFile } = makeHome({
    progress: ['updated_at: "2026-09-24"', 'nodes:', `  ${NEW_NODE}:`, '    notes: 传输那节', 'project:', '  current: ""', ''].join('\n'),
  });
  process.env.DSH_HOME = home;
  const { route } = connect();

  const response = await post(route, submission(workspace, { node: NEW_NODE }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tier, '已学完');
  assert.equal(fs.readFileSync(progressFile, 'utf8'), [
    'updated_at: "2026-09-24"',
    'nodes:',
    `  ${NEW_NODE}:`,
    '    status: 已学完',
    '    notes: 传输那节',
    'project:',
    '  current: ""',
    '',
  ].join('\n'));
});

test('两套读法对不上（节点键带了引号）：400 progress-invalid，绝不追加出重复键', async () => {
  const text = ['updated_at: "2026-09-24"', 'nodes:', `  "${NEW_NODE}":`, '    status: 学习中', 'project:', '  current: ""', ''].join('\n');
  const { home, workspace, progressFile } = makeHome({ progress: text });
  process.env.DSH_HOME = home;
  const { route } = connect();

  // 解析树里认得出这个节点（引号是 YAML 的写法），文本手术的键判据却认不出——
  // 这时**宁可拒绝**：猜错一步就会在同一个节点下写出一个重复键，后写的静默盖掉原来那份。
  const response = await post(route, submission(workspace, { node: NEW_NODE }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'progress-invalid');
  assert.match(body.error.message, /不敢就地改/);
  assert.equal(fs.readFileSync(progressFile, 'utf8'), text, '一个字都不许改');
});

test('CRLF 文件写回后仍是 CRLF（保形含换行风格）', async () => {
  const { home, workspace, progressFile } = makeHome({ eol: '\r\n' });
  process.env.DSH_HOME = home;
  const { route } = connect();

  assert.equal(fs.readFileSync(progressFile, 'utf8').includes('\r\n'), true, '夹具本身要是 CRLF');
  const response = await post(route, submission(workspace, { node: NEW_NODE }));
  assert.equal(response.status, 200);

  const after = fs.readFileSync(progressFile, 'utf8');
  assert.equal(after.includes('\r\n'), true);
  assert.equal(/\n/.test(after.replace(/\r\n/g, '')), false, '不许混进裸 LF');
  assert.match(after.replace(/\r\n/g, '\n'), new RegExp(`  ${NEW_NODE}:\\n    status: 已学完\\n`));
});

/* ── 2. 幂等 ──────────────────────────────────────────────────────────── */

test('重放同一个 operationId：回执相等、文件字节不变', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const body = submission(workspace);
  const first = await (await post(route, body)).json();
  const bytes = fs.readFileSync(progressFile);

  const replay = await post(route, body);
  assert.equal(replay.status, 200);
  const second = await replay.json();
  assert.deepEqual(second, first, '重放要原样回放上次的回执');
  assert.deepEqual(fs.readFileSync(progressFile), bytes, '重放后文件字节不变');
});

test('已经「已学完」再读完：一个字都不写，回当前版本号', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const first = await (await post(route, submission(workspace))).json();
  const bytes = fs.readFileSync(progressFile);

  const again = await (await post(route, submission(workspace, {
    expectedVersion: first.version, operationId: op('again'),
  }))).json();
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(again.tier, '已学完');
  assert.equal(again.version, first.version, '没动盘，版本号不该变');
  assert.deepEqual(fs.readFileSync(progressFile), bytes);
});

/* ── 3. 版本冲突与 operationId 冲突 ───────────────────────────────────── */

test('版本号对不上：409 拒绝、不写盘、带回当前版本号（阅读端据此重读）', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const 甲 = await (await post(route, submission(workspace))).json();
  const bytes = fs.readFileSync(progressFile);

  const stale = await post(route, submission(workspace, {
    expectedVersion: '0000000000000000', operationId: op('stale'),
  }));
  assert.equal(stale.status, 409);
  const refused = await stale.json();
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'version-conflict');
  assert.match(refused.error.message, /版本号对不上/, '拒绝的原因要是一句人话，阅读端原样带给学生');
  assert.equal(refused.version, 甲.version, '冲突时顺手带回当前版本号 = 已经重读过了');
  assert.equal(refused.message, undefined, '信封只有一种：message 在 error 里');
  assert.deepEqual(fs.readFileSync(progressFile), bytes, '被拒绝的那次不写盘');

  // 阅读端按带回的版本号重来：成功，状态还是「已学完」
  const retried = await (await post(route, submission(workspace, {
    expectedVersion: refused.version, operationId: op('retry'),
  }))).json();
  assert.equal(retried.ok, true);
  assert.equal(retried.tier, '已学完');
});

test('同一个 operationId 换了节点：409 operation-id-conflict，不写盘', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const id = op('same');
  await post(route, submission(workspace, { operationId: id }));
  const bytes = fs.readFileSync(progressFile);

  const conflict = await post(route, submission(workspace, {
    node: NEW_NODE, operationId: id, expectedVersion: progressVersion({ workspace, subject: SUBJECT }),
  }));
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.equal(body.error.code, 'operation-id-conflict');
  assert.match(body.error.message, /换个 operationId/, '给的说法要能照着做');
  assert.deepEqual(fs.readFileSync(progressFile), bytes);
});

/* ── 4. 实验课不动 ────────────────────────────────────────────────────── */

test('`kind: 实验` 的节点：读完不置位（它按验收结论置位），一个字节都不写', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const bytes = fs.readFileSync(progressFile);
  const response = await post(route, submission(workspace, { node: LAB_NODE }));
  assert.equal(response.status, 200, '学生读完说明页是事实，只是它不置位——不是报错');
  const receipt = await response.json();
  assert.equal(receipt.ok, true);
  assert.equal(receipt.changed, false);
  assert.equal(receipt.tier, '学习中');
  assert.match(receipt.reason, /实验课只按验收结论置位/);
  assert.deepEqual(fs.readFileSync(progressFile), bytes, '实验课的那一行不许动');
  assert.equal(readLibrary({ workspace }).subjects[0].nodes.find((item) => item.id === LAB_NODE).tier, '学习中');
});

/* ── 5. 请求体与状态码 ────────────────────────────────────────────────── */

test('只认「读完」：别的 event 一律 400 event-invalid（这条路不是通用进度写入口）', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  for (const event of ['开始学习', '证据通过', '要求复习', '学完了', '', null, 42]) {
    const response = await post(route, submission(workspace, { event, operationId: op('bad-event') }));
    assert.equal(response.status, 400, JSON.stringify(event));
    const body = await response.json();
    assert.equal(body.error.code, 'event-invalid');
    assert.match(body.error.message, /只认「读完」/);
  }
  // 缺 event 也走同一条（undefined 不是「读完」）
  const missing = await post(route, submission(workspace, { event: undefined, operationId: op('no-event') }));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, 'event-invalid');
  assert.equal(fs.readFileSync(progressFile, 'utf8'), progressText(), '坏请求一律不写盘');
});

test('坏请求：非 JSON、缺字段、越界科目/节点、没有 progress.yaml —— 400 且不写盘', async () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const { route } = connect();

  const notJson = await post(route, null, { body: '这不是 JSON' });
  assert.equal(notJson.status, 400);
  assert.equal((await notJson.json()).error.code, 'body-invalid');

  const cases = [
    ['operation-id-invalid', { operationId: undefined }],
    ['subject-invalid', { subject: '演示/科目' }],
    ['node-invalid', { node: '../net.layers' }],
    ['node-invalid', { node: 'net.missing' }],          // 大纲里没有这个节点
    ['expected-version-required', { expectedVersion: undefined }],
  ];
  for (const [error, overrides] of cases) {
    const response = await post(route, submission(workspace, Object.assign({ operationId: op('bad') }, overrides)));
    assert.equal(response.status, 400, error);
    const body = await response.json();
    assert.equal(body.error.code, error);
    assert.equal(typeof body.error.message, 'string');
    assert.notEqual(body.error.message, '', '拒绝必须带一句能给学生看的话');
  }
  assert.equal(fs.readFileSync(progressFile, 'utf8'), progressText(), '坏请求一律不写盘');

  // 没有 progress.yaml：没有落点就明确拒绝，不凭空造一份（updated_at / project 是 agent 的）
  const empty = makeHome();
  fs.rmSync(empty.progressFile);
  process.env.DSH_HOME = empty.home;
  const missing = await post(route, {
    subject: SUBJECT, node: NODE, event: '读完', operationId: op('missing'),
    expectedVersion: '0000000000000000',
  });
  assert.equal(missing.status, 400);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, 'progress-missing');
  assert.match(missingBody.error.message, /progress\.yaml/);
  assert.equal(fs.existsSync(empty.progressFile), false, '不许替 agent 造一份进度文件');

  // 只收 POST：别的动词给 405（宿主按 methods 过滤，这里是第二道）
  const wrongMethod = await route.fetch(new Request('http://127.0.0.1' + PROGRESS_PATH, { method: 'GET' }));
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error.code, 'method-not-allowed');
});

test('progress.yaml 坏掉（解析不了）：400 progress-invalid，不猜结构、不写盘', async () => {
  const { home, workspace, progressFile } = makeHome({
    progress: 'updated_at: "2026-09-24"\nnodes:\n  net.layers:\n    status: 学习中\nproject: {\n',
  });
  process.env.DSH_HOME = home;
  const { route } = connect();

  const bytes = fs.readFileSync(progressFile);
  const response = await post(route, submission(workspace));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'progress-invalid');
  assert.match(body.error.message, /读不出来/);
  assert.deepEqual(fs.readFileSync(progressFile), bytes);
});

test('没配工作区：500 加一句能自救的话，不抛', async () => {
  const { home } = makeHome();
  process.env.DSH_HOME = path.join(home, '空');   // 目录不存在 = 没配 workspace
  const { route } = connect();
  const response = await post(route, { subject: SUBJECT, node: NODE, event: '读完' });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'no-workspace');
  assert.match(body.error.message, /studymate-config\.yaml/);
});

/* ── 6. 数据层的出口与路由同一套判据 ──────────────────────────────────── */

test('数据层直接调（= 未来别的写入方）：与路由同一条栅栏、同一个回执形状', () => {
  const { home, workspace, progressFile } = makeHome();
  process.env.DSH_HOME = home;
  const version = progressVersion({ workspace, subject: SUBJECT });

  const result = writeProgress({
    workspace, subject: SUBJECT, node: NODE, event: '读完', operationId: op('direct'), expectedVersion: version,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tier, '已学完');
  assert.equal(result.version, progressVersion({ workspace, subject: SUBJECT }), '版本号与 readLibrary 同源');
  assert.equal(fs.readFileSync(progressFile, 'utf8').includes('status: 已学完'), true);
});
