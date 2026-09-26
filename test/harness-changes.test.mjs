import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { DEFAULT_REPORT_DIR, gitChangeSet } from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

// A platform-neutral repository root. `path.relative` normalizes the separators,
// and the implementation replaces them, so both a POSIX and a Windows host
// produce the same forward-slash link.
const CWD = '/repo';

/**
 * Exact-argument git fake. Matching on the whole argv rather than a substring
 * keeps `diff --numstat --` and `diff --cached --numstat --` distinct — a
 * substring match would answer the staged question with the unstaged answer and
 * hide a merge bug.
 */
function fakeRunner(responses) {
  return (cmd, args) => {
    const key = args.join(' ');
    if (Object.hasOwn(responses, key)) return { status: 0, stdout: responses[key], stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
}

const statusArgs = `-C ${CWD} status --porcelain --untracked-files=all`;
const unstagedArgs = `-C ${CWD} diff --numstat --`;
const stagedArgs = `-C ${CWD} diff --cached --numstat --`;

function changeSet(responses, options = {}) {
  return gitChangeSet(CWD, { runner: fakeRunner(responses), ...options });
}

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(`${relative(dir, full).replace(/\\/g, '/')}:${statSync(full).size}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

describe('gitChangeSet status mapping', () => {
  it('collapses both porcelain columns to one letter', () => {
    const res = changeSet({
      [statusArgs]: [
        ' M src/unstaged.mjs',
        'M  src/staged.mjs',
        'A  src/added.mjs',
        ' D src/deleted.mjs',
      ].join('\n') + '\n',
    });
    const byPath = Object.fromEntries(res.files.map((f) => [f.path, f.status]));
    assert.equal(byPath['src/unstaged.mjs'], 'M');
    assert.equal(byPath['src/staged.mjs'], 'M');
    assert.equal(byPath['src/added.mjs'], 'A');
    assert.equal(byPath['src/deleted.mjs'], 'D');
  });

  it('reports an untracked file as added, with no line count', () => {
    // An untracked file has no diff, so there is no number to report. Zero would
    // claim "changed nothing", which is a different and false statement.
    const res = changeSet({ [statusArgs]: '?? Assets/Scripts/New.cs\n' });
    assert.equal(res.available, true);
    assert.deepEqual(res.files, [{
      path: 'Assets/Scripts/New.cs',
      status: 'A',
      added: null,
      deleted: null,
      link: `[Assets/Scripts/New.cs](../../Assets/Scripts/New.cs)`,
    }]);
  });

  it('keeps the new path of a rename and marks it renamed', () => {
    const res = changeSet({
      [statusArgs]: 'R  src/old.mjs -> src/new.mjs\n',
      [stagedArgs]: '0\t0\tsrc/old.mjs => src/new.mjs\n',
    });
    assert.deepEqual(res.files.map((f) => [f.path, f.status]), [['src/new.mjs', 'R']]);
    assert.equal(res.counts.renamed, 1);
  });

  it('counts a deletion', () => {
    const res = changeSet({
      [statusArgs]: ' D src/gone.mjs\n',
      [unstagedArgs]: '0\t12\tsrc/gone.mjs\n',
    });
    assert.equal(res.files[0].status, 'D');
    assert.equal(res.files[0].deleted, 12);
    assert.equal(res.counts.deleted, 1);
  });
});

describe('gitChangeSet line counts', () => {
  it('sums the staged and unstaged counts for the same file', () => {
    // A file can appear in both diffs, and those counts add. Answering only one
    // of the two questions under-reports the change.
    const res = changeSet({
      [statusArgs]: 'MM src/a.mjs\n',
      [stagedArgs]: '10\t2\tsrc/a.mjs\n',
      [unstagedArgs]: '3\t1\tsrc/a.mjs\n',
    });
    assert.equal(res.files[0].added, 13);
    assert.equal(res.files[0].deleted, 3);
  });

  it('joins a braced rename form onto the same path as the status side', () => {
    const res = changeSet({
      [statusArgs]: 'R  dir/old.txt/file.txt -> dir/new.txt/file.txt\n',
      [stagedArgs]: '5\t0\tdir/{old.txt => new.txt}/file.txt\n',
    });
    assert.equal(res.files[0].path, 'dir/new.txt/file.txt');
    assert.equal(res.files[0].added, 5);
  });

  it('leaves a binary file count unknown rather than zero', () => {
    const res = changeSet({
      [statusArgs]: ' M Assets/logo.png\n',
      [unstagedArgs]: '-\t-\tAssets/logo.png\n',
    });
    assert.equal(res.files[0].added, null);
    assert.equal(res.files[0].deleted, null);
  });
});

describe('gitChangeSet links and ordering', () => {
  it('makes links relative to the report directory, not the repository root', () => {
    const res = changeSet({ [statusArgs]: ' M Assets/Foo.cs\n' });
    assert.equal(res.files[0].link, '[Assets/Foo.cs](../../Assets/Foo.cs)');
    assert.equal(DEFAULT_REPORT_DIR, '.cadet/reports');
  });

  it('deepens the link for a nested report directory', () => {
    const res = changeSet(
      { [statusArgs]: ' M Assets/Foo.cs\n' },
      { relativeTo: '.cadet/reports/archive' },
    );
    assert.equal(res.files[0].link, '[Assets/Foo.cs](../../../Assets/Foo.cs)');
  });

  it('sorts by path so the table is stable across runs', () => {
    const res = changeSet({
      [statusArgs]: [' M src/z.mjs', ' M src/a.mjs', ' M src/m.mjs'].join('\n') + '\n',
    });
    assert.deepEqual(res.files.map((f) => f.path), ['src/a.mjs', 'src/m.mjs', 'src/z.mjs']);
  });
});

describe('gitChangeSet scope', () => {
  it('filters Cadet bookkeeping by default and keeps it on request', () => {
    const responses = {
      [statusArgs]: [' M .cadet/state.json', ' M .cadet/runs/x.json', ' M src/a.mjs'].join('\n') + '\n',
    };
    assert.deepEqual(changeSet(responses).files.map((f) => f.path), ['src/a.mjs']);
    assert.deepEqual(
      changeSet(responses, { includeCadet: true }).files.map((f) => f.path),
      ['.cadet/runs/x.json', '.cadet/state.json', 'src/a.mjs'],
    );
  });

  it('diffs a base revision instead of the working tree when asked', () => {
    const range = 'main...HEAD';
    const res = changeSet({
      [`-C ${CWD} diff --name-status ${range} --`]: 'M\tsrc/a.mjs\nA\tsrc/b.mjs\n',
      [`-C ${CWD} diff --numstat ${range} --`]: '4\t1\tsrc/a.mjs\n',
    }, { range });
    assert.deepEqual(res.files.map((f) => [f.path, f.status]), [['src/a.mjs', 'M'], ['src/b.mjs', 'A']]);
    assert.equal(res.files[0].added, 4);
  });
});

describe('gitChangeSet availability', () => {
  it('reports why git could not be asked, instead of an empty change set', () => {
    // "no changes" and "cannot tell" must not look alike: the first is a fact the
    // report can state, the second is a limit it has to declare.
    const missing = gitChangeSet(CWD, { runner: () => null });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, 'git is not available');
    assert.deepEqual(missing.files, []);

    const notARepo = gitChangeSet(CWD, {
      runner: () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }),
    });
    assert.equal(notARepo.available, false);
    assert.match(notARepo.reason, /not a git repository/);
  });
});

describe('harness changes CLI', () => {
  it('exits 0 and reports unavailability outside a repository', () => {
    // Informational, not a gate: a review can still be completed without git, so
    // a missing repository must not block it.
    const dir = mkdtempSync(join(tmpdir(), 'cadet-changes-'));
    try {
      const res = spawnSync('node', [cli, 'harness', 'changes', '--target', dir, '--format', 'json'],
        { encoding: 'utf-8', cwd: dir, windowsHide: true });
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, true);
      assert.equal(out.available, false);
      assert.ok(out.reason, 'an unavailable inventory must carry a reason');
      assert.deepEqual(out.files, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists real working-tree changes end to end', () => {
    const probe = spawnSync('git', ['--version'], { encoding: 'utf-8', windowsHide: true });
    if (probe.error || probe.status !== 0) return; // git unavailable: nothing to assert

    const dir = mkdtempSync(join(tmpdir(), 'cadet-changes-git-'));
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf-8', windowsHide: true });
    try {
      git('init');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'tracked.mjs'), 'export const a = 1;\n');
      git('add', '.');
      git('commit', '-m', 'init');
      writeFileSync(join(dir, 'src', 'tracked.mjs'), 'export const a = 1;\nexport const b = 2;\n');
      writeFileSync(join(dir, 'src', 'untracked.mjs'), 'export const c = 3;\n');

      const before = snapshot(dir);
      const res = spawnSync('node', [cli, 'harness', 'changes', '--target', dir, '--format', 'json'],
        { encoding: 'utf-8', cwd: dir, windowsHide: true });
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.available, true);
      const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
      assert.equal(byPath['src/tracked.mjs'].status, 'M');
      assert.equal(byPath['src/tracked.mjs'].added, 1);
      assert.equal(byPath['src/untracked.mjs'].status, 'A');
      assert.equal(byPath['src/untracked.mjs'].added, null);
      assert.equal(byPath['src/tracked.mjs'].link, '[src/tracked.mjs](../../src/tracked.mjs)');

      // The command is declared read-only; it must not have touched the tree.
      const after = snapshot(dir);
      assert.deepEqual(after, before, `harness changes wrote: ${after.filter((f) => !before.includes(f)).join(', ')}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
