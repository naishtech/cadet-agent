import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  parseTestInventory, normalizeTestName, parseStoryCriteria, compareCoverage, describeCoverageGaps,
} from '../src/harness/verify-acs.mjs';
import { computeInputTreeHash } from '../src/harness/state.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'cadet-verify-acs-'));
}

// ── Report extraction (spec §3) ──────────────────────────────────────────────

describe('parseTestInventory — formats', () => {
  it('extracts names from Node TAP output', () => {
    const tap = [
      'TAP version 13',
      'ok 1 - Grid_DerivedFromMap_IsRectangular',
      'ok 2 - PackageManifest_HasNoDungeonArchitect',
      'not ok 3 - Grid_Something_Else',
      '1..3',
    ].join('\n');
    const inv = parseTestInventory(tap);
    assert.equal(inv.format, 'tap');
    assert.deepEqual(inv.names.sort(), [
      'Grid_DerivedFromMap_IsRectangular',
      'Grid_Something_Else',
      'PackageManifest_HasNoDungeonArchitect',
    ].sort());
    // A failing test still ran, so it is in the inventory.
    assert.ok(inv.names.includes('Grid_Something_Else'));
  });

  it('extracts names from JUnit XML', () => {
    const xml = `<?xml version="1.0"?>
<testsuite name="EditMode" tests="2">
  <testcase classname="GridTests" name="Grid_DerivedFromMap_IsRectangular" time="0.01"/>
  <testcase classname="ManifestTests" name="PackageManifest_HasNoDungeonArchitect" time="0.02"/>
</testsuite>`;
    const inv = parseTestInventory(xml);
    assert.equal(inv.format, 'junit');
    assert.equal(inv.names.length, 2);
    assert.ok(inv.names.includes('Grid_DerivedFromMap_IsRectangular'));
  });

  it('extracts names from Unity JSON output', () => {
    const json = JSON.stringify({
      tests: [
        { name: 'Grid_DerivedFromMap_IsRectangular', result: 'Passed' },
        { name: 'PackageManifest_HasNoDungeonArchitect', result: 'Failed' },
      ],
    });
    const inv = parseTestInventory(json);
    assert.equal(inv.format, 'unity-json');
    assert.equal(inv.names.length, 2);
  });

  it('returns an empty inventory with format unknown for unrecognized output', () => {
    const inv = parseTestInventory('some other tool output\nnothing to see');
    assert.equal(inv.format, 'unknown');
    assert.deepEqual(inv.names, []);
  });

  it('returns an empty inventory for empty or nullish input', () => {
    for (const v of ['', null, undefined]) {
      const inv = parseTestInventory(v);
      assert.deepEqual(inv.names, []);
      assert.equal(inv.format, 'unknown');
    }
  });

  it('truncates an oversized report and marks the inventory partial', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `ok ${i + 1} - Test_${i}`).join('\n');
    const inv = parseTestInventory(big, { maxBytes: 512 });
    assert.equal(inv.partial, true);
    assert.ok(inv.names.length > 0 && inv.names.length < 5000);
  });
});

describe('normalizeTestName', () => {
  it('trims and collapses internal whitespace', () => {
    assert.equal(normalizeTestName('  Grid_Foo   Bar '), 'Grid_Foo Bar');
  });

  it('strips a trailing duplicate-index suffix', () => {
    assert.equal(normalizeTestName('Grid_Foo (1)'), 'Grid_Foo');
  });

  it('is case-sensitive (conservative by design)', () => {
    assert.notEqual(normalizeTestName('Grid_Foo'), normalizeTestName('grid_foo'));
  });
});

// ── Story parsing (spec §5.1 step 1) ─────────────────────────────────────────

describe('parseStoryCriteria', () => {
  function writeStory(dir, body) {
    const path = join(dir, 'story-1.md');
    writeFileSync(path, body);
    return path;
  }

  it('extracts AC ids and their declared tests', () => {
    const dir = tmpDir();
    try {
      const path = writeStory(dir, [
        '# Story: Grid',
        '',
        '## Acceptance Criteria',
        '### AC-1: grid is rectangular',
        '- Given a map, When loaded, Then the grid is rectangular',
        '- Declared tests:',
        '  - Grid_DerivedFromMap_IsRectangular',
        '',
        '### AC-2: no dungeon architect dependency',
        '- Given the manifest, When parsed, Then no DungeonArchitect ref',
        '- Declared tests: PackageManifest_HasNoDungeonArchitect',
        '',
        '## Scope',
      ].join('\n'));
      const parsed = parseStoryCriteria(path);
      assert.equal(parsed.criteria.length, 2);
      assert.equal(parsed.criteria[0].id, 'AC-1');
      assert.deepEqual(parsed.criteria[0].tests, ['Grid_DerivedFromMap_IsRectangular']);
      assert.equal(parsed.criteria[1].id, 'AC-2');
      assert.deepEqual(parsed.criteria[1].tests, ['PackageManifest_HasNoDungeonArchitect']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags an AC that declares no test as undeclared', () => {
    const dir = tmpDir();
    try {
      const path = writeStory(dir, [
        '## Acceptance Criteria',
        '### AC-1: something',
        '- Given a, When b, Then c',
        '',
      ].join('\n'));
      const parsed = parseStoryCriteria(path);
      assert.equal(parsed.criteria[0].tests.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects duplicate AC ids, naming the id', () => {
    const dir = tmpDir();
    try {
      const path = writeStory(dir, [
        '## Acceptance Criteria',
        '### AC-1: first',
        '- Given a, When b, Then c',
        '### AC-1: second',
        '- Given d, When e, Then f',
      ].join('\n'));
      assert.throws(() => parseStoryCriteria(path), /duplicate AC id.*AC-1/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects a criterion heading with no AC id, naming the heading', () => {
    const dir = tmpDir();
    try {
      const path = writeStory(dir, [
        '## Acceptance Criteria',
        '### grid is rectangular',
        '- Given a, When b, Then c',
      ].join('\n'));
      assert.throws(() => parseStoryCriteria(path), /AC id/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports every AC as undeclared for a story with no Declared tests lines', () => {
    const dir = tmpDir();
    try {
      const path = writeStory(dir, [
        '## Acceptance Criteria',
        '### AC-1: a',
        '- Given a, When b, Then c',
        '### AC-2: b',
        '- Given d, When e, Then f',
      ].join('\n'));
      const parsed = parseStoryCriteria(path);
      assert.equal(parsed.criteria.every((c) => c.tests.length === 0), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── The story template must carry the C10 fields ─────────────────────────────

describe('story template (C10)', () => {
  it('exposes an AC id slot and a declared-tests slot', () => {
    const tpl = readFileSync(join(repoRoot, '.cadet', 'agent', 'core', 'templates', 'StoryTemplate.md'), 'utf-8');
    assert.match(tpl, /slot id="acId"/, 'story template must define an acId slot');
    assert.match(tpl, /slot id="declaredTests"/, 'story template must define a declaredTests slot');
  });
});

// ── Coverage comparison (spec §5.1 steps 3–4) ────────────────────────────────

describe('compareCoverage', () => {
  it('marks an AC covered when every declared test is present', () => {
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['Grid_Foo'] }],
      { names: ['Grid_Foo', 'Other'], format: 'tap' },
    );
    assert.equal(c.ok, true);
    assert.equal(c.ac[0].status, 'covered');
  });

  it('marks an AC missing and reports the absent test', () => {
    const c = compareCoverage(
      [{ id: 'AC-2', tests: ['PackageManifest_HasNoDungeonArchitect'] }],
      { names: ['Grid_Foo'], format: 'tap' },
    );
    assert.equal(c.ok, false);
    assert.equal(c.ac[0].status, 'missing');
    const gaps = describeCoverageGaps(c);
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /AC-2/);
    assert.match(gaps[0], /PackageManifest_HasNoDungeonArchitect/);
  });

  it('marks an AC with no declared test as undeclared', () => {
    const c = compareCoverage([{ id: 'AC-3', tests: [] }], { names: ['x'], format: 'tap' });
    assert.equal(c.ac[0].status, 'undeclared');
    assert.match(describeCoverageGaps(c)[0], /declares no test/);
  });

  it('reports every gap together, not just the first', () => {
    const c = compareCoverage(
      [
        { id: 'AC-1', tests: ['Missing_A'] },
        { id: 'AC-2', tests: ['Missing_B'] },
        { id: 'AC-3', tests: [] },
      ],
      { names: ['Present'], format: 'tap' },
    );
    const gaps = describeCoverageGaps(c);
    assert.equal(gaps.length, 3, 'all three gaps must be listed in one pass');
  });

  it('does not satisfy coverage from an unknown-format (empty) inventory', () => {
    const c = compareCoverage([{ id: 'AC-1', tests: ['Anything'] }], { names: [], format: 'unknown' });
    assert.equal(c.ok, false);
    assert.equal(c.ac[0].status, 'missing');
  });

  it('matches after normalization but not across case', () => {
    const ok = compareCoverage([{ id: 'AC-1', tests: ['Grid_Foo'] }], { names: ['  Grid_Foo (1) '], format: 'tap' });
    assert.equal(ok.ok, true);
    const bad = compareCoverage([{ id: 'AC-1', tests: ['Grid_Foo'] }], { names: ['grid_foo'], format: 'tap' });
    assert.equal(bad.ok, false);
  });
});

// ── Orphan detection (the inverse direction) ─────────────────────────────────
//
// The declared→delivered check cannot see a test that RAN but is declared on no
// AC: it only iterates the criteria. That drift has recurred repeatedly, so the
// inverse is checked explicitly here.

describe('compareCoverage — orphaned tests', () => {
  it('reports a test that ran but is declared on no AC', () => {
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['Declared_A'] }],
      { names: ['Declared_A', 'Ran_But_Undeclared'], format: 'tap' },
    );
    assert.deepEqual(c.orphaned, ['Ran_But_Undeclared']);
  });

  it('reports no orphans when every inventory test is declared', () => {
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['A', 'B'] }],
      { names: ['A', 'B'], format: 'tap' },
    );
    assert.deepEqual(c.orphaned, []);
  });

  it('does not count a test declared on ANY ac as an orphan', () => {
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['A'] }, { id: 'AC-2', tests: ['B'] }],
      { names: ['A', 'B'], format: 'tap' },
    );
    assert.deepEqual(c.orphaned, []);
  });

  it('normalizes orphan names the same way as the declared side', () => {
    // A trailing duplicate-index suffix and surrounding whitespace are not drift.
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['A'] }],
      { names: ['A', '  B (1) '], format: 'tap' },
    );
    assert.deepEqual(c.orphaned, ['B']);
  });

  it('keeps orphans non-fatal: ok stays true when only orphans exist', () => {
    // Consumers legitimately have helper tests declared on no AC. Reporting them
    // must not silently break every existing story.
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['A'] }],
      { names: ['A', 'Helper_Not_On_An_AC'], format: 'tap' },
    );
    assert.equal(c.ok, true);
  });

  it('surfaces orphans through describeCoverageGaps only when asked', () => {
    const c = compareCoverage(
      [{ id: 'AC-1', tests: ['A'] }],
      { names: ['A', 'Orphaned_One', 'Orphaned_Two'], format: 'tap' },
    );
    // Default: the declared→delivered gap list is unchanged (backward compatible).
    assert.deepEqual(describeCoverageGaps(c), []);
    const withOrphans = describeCoverageGaps(c, { includeOrphans: true });
    assert.equal(withOrphans.length, 2);
    assert.match(withOrphans.join('\n'), /Orphaned_One/);
    assert.match(withOrphans.join('\n'), /Orphaned_Two/);
    assert.match(withOrphans.join('\n'), /declared on no acceptance criterion/);
  });

  it('does not invent orphans from an unknown-format (empty) inventory', () => {
    // Unknown is never silently zero — but it is also never evidence of drift.
    const c = compareCoverage([{ id: 'AC-1', tests: ['A'] }], { names: [], format: 'unknown' });
    assert.deepEqual(c.orphaned, []);
  });
});

// ── CLI: harness verify-acs (spec §5) ────────────────────────────────────────

const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, cwd = repoRoot) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function makeProject({ strict = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-acs-cli-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
  }, null, 2));
  if (strict) {
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({ strictClosure: { enabled: true } }, null, 2));
  }
  const story = join(dir, 'story-1.md');
  writeFileSync(story, [
    '## Acceptance Criteria',
    '### AC-1: grid',
    '- Given a map, When loaded, Then rectangular',
    '- Declared tests: Grid_Foo, Grid_Missing',
    '',
  ].join('\n'));
  const report = join(dir, 'report.txt');
  writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', '1..1'].join('\n'));
  return { dir, story, report };
}

describe('cli — harness verify-acs', () => {
  it('rejects a missing --story', () => {
    const res = runCli(['harness', 'verify-acs', '--format', 'json']);
    assert.equal(res.status, 1);
  });

  it('blocks when no report can be resolved', () => {
    const { dir, story } = makeProject();
    try {
      const res = runCli(['harness', 'verify-acs', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).code, 'no-test-report');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports gaps and exits 1 with strictClosure off, writing no state', () => {
    const { dir, story, report } = makeProject();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, false);
      assert.equal(out.gateSet, false);
      const after = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      assert.equal(after, before, 'state.json must be byte-identical when strictClosure is off');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('sets acceptanceCriteriaValidated when every declared test is present (strict)', () => {
    const { dir } = makeProject({ strict: true });
    try {
      // A story whose only declared test IS present.
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a map, When loaded, Then rectangular',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const report = join(dir, 'report.txt');
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.gateSet, true);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates.acceptanceCriteriaValidated, true);
      assert.ok(state.gateEvidence.some((e) => e.gate === 'acceptanceCriteriaValidated' && e.status === 'passed'));

      // The produced state must pass the tool's OWN validator. Without this the
      // record shape can drift from the schema unnoticed (freshnessPolicy was
      // written as a bare string while the validator requires an object).
      const validate = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(validate.status, 0, `state validate rejected verify-acs output: ${validate.stdout}${validate.stderr}`);
      assert.equal(JSON.parse(validate.stdout).valid, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // ── The commit citation (AR-1 / policies/gate-commit-citation.md) ──────────
  // The flag was ACCEPTED and silently dropped on these two gates until 0.53.0:
  // the CLI parsed --commit for every command while only verify/confirm stored it,
  // so a record that the policy requires to cite its revision could never carry one.

  it('records the cited revision on the evidence when --commit is passed', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const sha = 'adca5ae59967068a2eb56511dd23362479d67b7f';
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', join(dir, 'report.txt'),
        '--target', dir, '--commit', sha, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const ev = state.gateEvidence.find((e) => e.gate === 'acceptanceCriteriaValidated');
      assert.equal(ev.commit, sha, 'the record must cite the revision it attests');

      const validate = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(validate.status, 0, `state validate rejected the cited record: ${validate.stdout}${validate.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves commit null when no revision is cited', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', join(dir, 'report.txt'),
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gateEvidence.find((e) => e.gate === 'acceptanceCriteriaValidated').commit, null,
        'uncommitted work may leave the citation null');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a branch or tag name as a citation, and writes no record', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', join(dir, 'report.txt'),
        '--target', dir, '--commit', 'main', '--format', 'json']);
      assert.equal(res.status, 1, 'a symbolic revision cannot be cited: it moves');
      assert.match(res.stderr, /4-40 character hex revision identifier/);
      assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before,
        'a refused citation must not leave a record behind');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes a freshnessPolicy the schema accepts (object with a scope)', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', join(dir, 'report.txt'), '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const ev = state.gateEvidence.find((e) => e.gate === 'acceptanceCriteriaValidated');
      assert.ok(ev, 'evidence record must exist');
      assert.equal(typeof ev.freshnessPolicy, 'object', 'freshnessPolicy must be an object, not a string');
      assert.ok(['story', 'phase', 'run', 'manual'].includes(ev.freshnessPolicy.scope), 'scope must be one of story|phase|run|manual');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('binds the story and not the generated report, so re-running the tests cannot stale the record', () => {
    // The defect: `verify-acs` hashed the report it had just read into its
    // `inputTreeHash`. A test script that rewrites a fixed report path
    // (`test-results-junit.xml` and friends) therefore invalidated the AC record
    // the moment it re-ran the tests — the evidence was staled by the very command
    // that produced its inventory. The report is the run's OUTPUT, so it is kept as
    // `artifactPath` for audit but must not be a relevant file.
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      const storyText = [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n');
      writeFileSync(story, storyText);
      const report = join(dir, 'report.txt');
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', '1..1'].join('\n'));

      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const ev = state.gateEvidence.find((e) => e.gate === 'acceptanceCriteriaValidated');
      assert.ok(ev, 'evidence record must exist');

      // The binding is the story alone, recorded repo-relative so the freshness
      // re-derivation at transition time actually resolves it under the root.
      assert.deepEqual(ev.relevantFiles, ['story-ok.md']);
      assert.equal(computeInputTreeHash(dir, ev.relevantFiles), ev.inputTreeHash,
        'the recorded hash must re-derive from the recorded relevant files (a live binding, not an inert one)');
      // The report is retained for audit, where nothing re-hashes it.
      assert.ok(String(ev.artifactPath || '').endsWith('report.txt'),
        `artifactPath should name the report for audit, got ${JSON.stringify(ev.artifactPath)}`);

      // Re-running the tests rewrites the report. The record must survive it.
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', 'ok 2 - Grid_Extra', '1..2'].join('\n'));
      assert.equal(computeInputTreeHash(dir, ev.relevantFiles), ev.inputTreeHash,
        'rewriting the generated report must not change the AC input tree');

      // The produced state must still pass the tool's own validator.
      const validate = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(validate.status, 0, `state validate rejected verify-acs output: ${validate.stdout}${validate.stderr}`);

      // The story IS a real input: editing it must invalidate the record.
      writeFileSync(story, `${storyText}\n- extra note\n`);
      assert.notEqual(computeInputTreeHash(dir, ev.relevantFiles), ev.inputTreeHash,
        'editing the story must invalidate the AC input tree');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('names the missing test and leaves the gate unset (strict)', () => {
    const { dir, story, report } = makeProject({ strict: true });
    try {
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir]);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Grid_Missing/);
      assert.match(res.stderr, /AC-1/);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.notEqual(state.gates.acceptanceCriteriaValidated, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes a coverage artifact with --write-coverage', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, [
        '## Acceptance Criteria',
        '### AC-1: grid',
        '- Given a, When b, Then c',
        '- Declared tests: Grid_Foo',
      ].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', join(dir, 'report.txt'), '--write-coverage', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.ok(out.coveragePath && existsSync(out.coveragePath));
      const doc = JSON.parse(readFileSync(out.coveragePath, 'utf-8'));
      assert.equal(doc.ac[0].status, 'covered');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never passes on an unparseable report (strict)', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, ['## Acceptance Criteria', '### AC-1: a', '- Given a, When b, Then c', '- Declared tests: Grid_Foo'].join('\n'));
      const junk = join(dir, 'junk.txt');
      writeFileSync(junk, 'this is not a test report');
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', junk, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).code, 'inventory-unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports orphans without failing by default (strictClosure off)', () => {
    const { dir } = makeProject();
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, ['## Acceptance Criteria', '### AC-1: a', '- Given a, When b, Then c', '- Declared tests: Grid_Foo'].join('\n'));
      const report = join(dir, 'orphan-report.txt');
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', 'ok 2 - Helper_On_No_AC', '1..2'].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, true, 'orphans alone must not fail the check');
      assert.deepEqual(out.orphaned, ['Helper_On_No_AC']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists orphans on stderr when strictClosure is off but still passes', () => {
    const { dir } = makeProject();
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, ['## Acceptance Criteria', '### AC-1: a', '- Given a, When b, Then c', '- Declared tests: Grid_Foo'].join('\n'));
      const report = join(dir, 'orphan-report.txt');
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', 'ok 2 - Helper_On_No_AC', '1..2'].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir]);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stderr, /declared on no acceptance criterion/);
      assert.match(res.stderr, /Helper_On_No_AC/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // ── Discrimination: the new check must be ABLE to fail ──────────────────────
  // Without this, --strict-orphans could silently become a no-op and still
  // "pass" — the exact defect class F57 recorded for the old behaviour.

  it('--strict-orphans fails and reports code orphaned-tests (strict)', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, ['## Acceptance Criteria', '### AC-1: a', '- Given a, When b, Then c', '- Declared tests: Grid_Foo'].join('\n'));
      const report = join(dir, 'orphan-report.txt');
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', 'ok 2 - Helper_On_No_AC', '1..2'].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--strict-orphans', '--format', 'json']);
      assert.equal(res.status, 1, 'an orphan must fail under --strict-orphans');
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, false);
      assert.equal(out.code, 'orphaned-tests');
      assert.equal(out.gateSet, false);
      assert.deepEqual(out.orphaned, ['Helper_On_No_AC']);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.notEqual(state.gates.acceptanceCriteriaValidated, true, 'the gate must stay unset');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--strict-orphans still passes when there are no orphans (control)', () => {
    const { dir } = makeProject({ strict: true });
    try {
      const story = join(dir, 'story-ok.md');
      writeFileSync(story, ['## Acceptance Criteria', '### AC-1: a', '- Given a, When b, Then c', '- Declared tests: Grid_Foo'].join('\n'));
      const report = join(dir, 'no-orphan-report.txt');
      writeFileSync(report, ['TAP version 13', 'ok 1 - Grid_Foo', '1..1'].join('\n'));
      const res = runCli(['harness', 'verify-acs', '--story', story, '--report', report, '--target', dir, '--strict-orphans', '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout).gateSet, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('verify-acs — where the story is read from', () => {
  // The defect this pins: `harness verify-acs --story <path> --target <dir>` parsed the story
  // relative to the PROCESS WORKING DIRECTORY while binding the evidence to
  // `<target>/<story>`. So the command failed when run from outside the project, and — worse —
  // when a file of that name existed under the working directory it attested THAT file's criteria
  // against the target's path: the silently-inert binding verify-reachability's own comment warns
  // about. Every other path flag in the CLI resolves against the target; this pins that this one
  // does too, from a working directory that is not the target.
  function acsFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-acs-target-'));
    mkdirSync(join(dir, '.cadet'), { recursive: true });
    mkdirSync(join(dir, 'stories'), { recursive: true });
    mkdirSync(join(dir, 'reports'), { recursive: true });
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({}));
    writeFileSync(join(dir, 'stories', 'story-1.md'), [
      'Status: In progress',
      'Reachability: witnessed — the counter rises in the demo scene',
      '',
      '## Acceptance Criteria',
      '',
      '### AC-1: rectangular',
      '',
      '- Declared tests: Grid_IsRectangular',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'reports', 'tap.txt'), ['TAP version 13', 'ok 1 - Grid_IsRectangular', '1..1'].join('\n'));
    spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', '.'], { cwd: dir, encoding: 'utf-8' });
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'fixture'], { encoding: 'utf-8' });
    writeFileSync(join(dir, 'stories', 'story-1.md'), readFileSync(join(dir, 'stories', 'story-1.md'), 'utf-8') + '\nEdited by the story.\n');
    return dir;
  }

  it('reads the story and the report from --target, not from the working directory', () => {
    const dir = acsFixture();
    try {
      const init = spawnSync('node', [cli, 'state', 'init', '--target', dir], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
      assert.equal(init.status, 0, init.stdout + init.stderr);
      const begin = spawnSync('node', [cli, 'state', 'begin', '--epic', 'E-1', '--story', 'stories/story-1.md', '--target', dir], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
      assert.equal(begin.status, 0, begin.stdout + begin.stderr);

      // The working directory is the framework repository, which has no `stories/story-1.md`.
      const r = spawnSync('node', [cli, 'harness', 'verify-acs', '--story', 'stories/story-1.md',
        '--report', 'reports/tap.txt', '--target', dir, '--format', 'json'],
      { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
      assert.equal(r.status, 0, `the story and the report must resolve inside the target: ${r.stdout}${r.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
