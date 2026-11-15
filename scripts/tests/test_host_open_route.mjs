/* 「打开资料」这条路由的特征化套件。
   ────────────────────────────────────────────────────────────────────────────────
   这是本插件**唯一一条会启动进程**的路由（`spawn` 交给系统去开默认应用 / 文件管理器），
   所以围栏必须钉住：目标只能是**本科目目录下的既有常规文件**，且动作名是白名单。
   断言分两半：
     · `resolveOpenTarget` 是纯的（只读盘、不启动进程）——围栏在这里逐条断；
     · `spawnOpen` 收一个可注入的 spawn——断的是**命令行的形状**（目标路径永远是单独一个 argv，
       没有任何拼接），不真去开窗口。
   本机是 CRLF 检出，但这份套件不解析 `lib/client.js` 的 CSS，所以不受那条假红影响。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODULE = path.join(ROOT, 'lib', 'open-route.ts');

const { resolveOpenTarget, spawnOpen, OPEN_PATH, OPEN_MODES } = await import(new URL(`file://${MODULE.replace(/\\/g, '/')}`).href);

/** 造一个最小的工作区：`<tmp>/.learning/subjects/<slug>/reference/…`。 */
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-open-'));
  const subject = path.join(dir, '.learning', 'subjects', 'demo');
  fs.mkdirSync(path.join(subject, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(subject, 'reference', 'a.md'), '# hi\n');
  fs.writeFileSync(path.join(subject, 'reference', '表 格.xlsx'), 'not really xlsx');
  fs.writeFileSync(path.join(dir, '外面.txt'), 'outside\n');
  return { dir, subject };
}

test('围栏：越出科目目录的路径一律拒绝（.. 与绝对路径都在 path.resolve 这一步被挡下）', () => {
  const { dir } = workspace();
  const bad = [
    '../外面.txt',
    '../../外面.txt',
    '../../../外面.txt',
    path.join('reference', '..', '..', '..', '外面.txt'),
    path.resolve(dir, '外面.txt'),                 // 绝对路径
  ];
  for (const one of bad) {
    const out = resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: one });
    assert.equal(out.ok, false, `应该拒绝：${one}`);
    assert.equal(out.code, 'path-invalid', `拒绝码不对：${one} → ${out.code}`);
  }
});

test('围栏：科目 slug 只能是一层目录名', () => {
  const { dir } = workspace();
  for (const slug of ['', '.', '..', 'demo/../outro', 'a\\b']) {
    const out = resolveOpenTarget({ workspace: dir, subject: slug, relPath: 'reference/a.md' });
    assert.equal(out.ok, false, `应该拒绝 slug：${JSON.stringify(slug)}`);
    assert.equal(out.code, 'subject-invalid');
  }
});

test('围栏：目录、不存在的文件、空路径各有自己的码', () => {
  const { dir } = workspace();
  assert.equal(resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: 'reference' }).code, 'not-a-file');
  assert.equal(resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: 'reference/没有.md' }).code, 'not-found');
  assert.equal(resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: '' }).code, 'path-invalid');
});

test('围栏：符号链接指向科目目录之外时也拒绝（statSync 会跟链，所以还要比一次 realpath）', t => {
  const { dir, subject } = workspace();
  const link = path.join(subject, 'reference', '逃出去.txt');
  try {
    fs.symlinkSync(path.join(dir, '外面.txt'), link, 'file');
  } catch (error) {
    t.skip(`这台机器建不了符号链接：${error.code}`);
    return;
  }
  const out = resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: 'reference/逃出去.txt' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'path-invalid');
});

test('放行：科目目录下的常规文件，回的是科目目录下的相对路径（不回显绝对路径）', () => {
  const { dir } = workspace();
  const out = resolveOpenTarget({ workspace: dir, subject: 'demo', relPath: 'reference/表 格.xlsx' });
  assert.equal(out.ok, true);
  assert.equal(out.rel, 'reference/表 格.xlsx');
});

test('spawnOpen：目标路径永远是单独一个 argv，不做任何拼接', () => {
  const calls = [];
  const fake = (command, args) => { calls.push({ command, args }); return { on() {}, unref() {} }; };
  const tricky = 'C:\\学习 目录\\reference\\带 & 和 % 的名.xlsx';

  spawnOpen(tricky, 'open', 'win32', fake);
  assert.deepEqual(calls.at(-1), { command: 'cmd.exe', args: ['/c', 'start', '', tricky] });

  spawnOpen(tricky, 'reveal', 'win32', fake);
  assert.deepEqual(calls.at(-1), { command: 'explorer.exe', args: [`/select,${tricky}`] });

  spawnOpen('/tmp/a b.pdf', 'open', 'darwin', fake);
  assert.deepEqual(calls.at(-1), { command: 'open', args: ['/tmp/a b.pdf'] });

  spawnOpen('/tmp/a b.pdf', 'reveal', 'darwin', fake);
  assert.deepEqual(calls.at(-1), { command: 'open', args: ['-R', '/tmp/a b.pdf'] });

  spawnOpen('/tmp/a b.pdf', 'open', 'linux', fake);
  assert.deepEqual(calls.at(-1), { command: 'xdg-open', args: ['/tmp/a b.pdf'] });

  // 每一次调用里，目标路径都只出现在 args 里、且是完整的一项（没有 shell 拼接）
  for (const one of calls) {
    assert.ok(one.args.some((arg) => arg === tricky || arg === '/tmp/a b.pdf' || arg === `/select,${tricky}` || arg === '/tmp'));
  }
  assert.equal(calls.length, 5);
});

test('路径与动作词表的形状', () => {
  assert.equal(OPEN_PATH, '/api/studymate/open');
  assert.deepEqual([...OPEN_MODES], ['open', 'reveal']);
});
