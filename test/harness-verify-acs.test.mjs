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
});
