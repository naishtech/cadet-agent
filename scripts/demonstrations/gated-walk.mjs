#!/usr/bin/env node
/**
 * Demonstration: one work item from clarification to human acceptance, gated at every boundary.
 *
 * It drives the real CLI in a throwaway repository and never asserts by reading the framework's
 * source: every verdict below is an exit code and a message the commands themselves produced. At
 * each boundary the walk first shows the REFUSAL, names the gates it asked for, satisfies them
 * through the route the registry declares for each one, and then shows the boundary open.
 *
 * It also exercises the refusals that make the gates worth having — an exit-zero command that
 * cannot satisfy a semantic gate, the manual route prohibited for the gates that it would make
 * unsatisfiable, an incomplete design review, a failing architecture check, a stale context record,
 * and an undeclared reachability claim.
 *
 * Usage:  node scripts/demonstrations/gated-walk.mjs [--keep]
 * Exits non-zero if any expectation fails, so a regression in any of these shows up as a failure
 * rather than as a transcript someone reads and believes.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const keep = process.argv.includes('--keep');
const scratchRoot = process.env.TMPDIR || process.env.BH_AGENT_WORKSPACE || tmpdir();

let failures = 0;
const pass = (label, detail = '') => console.log(`   PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => { failures += 1; console.log(`   FAIL  ${label}${detail ? ` — ${detail}` : ''}`); };
const check = (ok, label, detail = '') => (ok ? pass(label, detail) : fail(label, detail));

const run = (args, cwd = repoRoot) => new Promise((resolve) => {
  const child = spawn('node', [cli, ...args], { cwd, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, text: `${stdout}${stderr}` }));
});

/** The gates a refusal names, so the walk satisfies exactly what the boundary asked for. */
const namedGates = (text) => {
  const m = /missing gates\/evidence: ([^\n]+)/.exec(text);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};

const EXPIRY = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

// ── The fixture: a Unity-shaped repository with one story in flight ────────────

function buildFixture() {
  const dir = join(scratchRoot, `cadet-gated-walk-${Date.now()}`);
  for (const p of ['.cadet', 'stories', 'tests', 'reports', 'docs', 'tools', 'ProjectSettings', 'Assets/Scripts']) {
    mkdirSync(join(dir, p), { recursive: true });
  }
  writeFileSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.40f1\n');

  // The policy: the shipped seed, with the three opt-ins this walk exercises.
  const policy = JSON.parse(readFileSync(join(repoRoot, '.cadet', 'harness.json'), 'utf-8'));
  policy.reachability = { ...(policy.reachability || {}), enabled: true };
  policy.designReview = { enabled: true };
  policy.humanAcceptance = { enabled: true };
  policy.architectureFitness = {
    enabled: true,
    checks: [{
      id: 'no-vendor-dependency',
      // No `files` scope: this is a constraint on the repository, so it always applies. The
      // policy key is `files`; `scopes` is the internal field name and is rejected by the
      // validator, which is how this walk found it.
      command: 'node tools/arch-check.mjs',
      severity: 'required',
    }],
  };
  writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2));
  // The managed framework files an install leaves behind: the commands generate artifacts from
  // the templates here (the acceptance form, for one), so a fixture without them is not an install.
  cpSync(join(repoRoot, '.cadet', 'agent'), join(dir, '.cadet', 'agent'), { recursive: true });

  // A real test that describes behaviour the implementation does not have yet — the red step, and
  // the reason the framework refuses a green-only `testsPassed` claim.
  writeFileSync(join(dir, 'tests', 'inventory.test.mjs'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryGrid } from '../Assets/Scripts/InventoryGrid.cs.mjs';

test('Inventory_Grid_IsRectangular', () => {
  const grid = new InventoryGrid();
  assert.equal(grid.Columns, 4, 'the grid has four columns');
  assert.equal(grid.Rows, 3, 'the grid has three rows');
});
`);
  writeFileSync(join(dir, 'tools', 'arch-check.mjs'), `// The declared architecture constraint, as a command whose exit code is the verdict:
// "Assets must not reference the vendor dungeon package".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const offenders = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.cs') && /DungeonArchitect/.test(readFileSync(p, 'utf-8'))) offenders.push(p);
  }
};
walk('Assets');
if (offenders.length) { console.error('forbidden dependency in: ' + offenders.join(', ')); process.exit(1); }
console.log('no forbidden dependency');
`);
  writeFileSync(join(dir, 'Assets', 'Scripts', 'InventoryGrid.cs'), 'namespace Game { class InventoryGrid {} }\n');

  // The story: acceptance criteria whose declared test exists, and a reachability claim.
  writeFileSync(join(dir, 'stories', 'inventory-1.md'), `# Story: inventory grid

Status: In progress
Reachability: witnessed — the counter rises in the demo scene when an item is collected

## Acceptance Criteria

### AC-1: the grid is rectangular

The grid must have the same column count in every row.

- Declared tests: Inventory_Grid_IsRectangular

### AC-2: a picked-up item leaves the grid

- Declared tests: Inventory_Grid_IsRectangular

## Notes

Nothing else.
`);

  // The reviewed design artifacts the design review reads.
  writeFileSync(join(dir, 'docs', 'design.md'), '# Technical design: inventory\n\nThe grid derives its columns from the map.\n');
  writeFileSync(join(dir, 'docs', 'requirements.md'), '# Requirements\n\nA rectangular grid.\n');

  // A real repository: freshness coverage (which files a record may bind) and the scope selection
  // for architecture checks are both established from git, not invented by the tool.
  spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', '.'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  spawnSync('git', ['-C', dir, '-c', 'user.email=demo@example.com', '-c', 'user.name=Demo', 'commit', '-q', '-m', 'fixture'], { stdio: 'ignore' });

  // The story's own work, uncommitted, which is what a work item in flight looks like — and what
  // the evidence binds to: freshness coverage is established from the files that changed. It does
  // NOT satisfy the test yet: the point of the red step is that the implementation is still absent.
  writeFileSync(join(dir, 'Assets', 'Scripts', 'InventoryGrid.cs.mjs'),
    'export class InventoryGrid { constructor() { this.Columns = 0; this.Rows = 0; } }\n');
  return dir;
}

/** A design review that satisfies the artifact contract, and one that does not. */
function writeDesignReview(dir, { row = '| DR-1 | The map format assumes fixed 4-neighbour adjacency, so diagonal placement is uncovered. | medium | accepted | docs/design.md §Grid |' } = {}) {
  const path = join(dir, 'docs', 'DesignReview.md');
  writeFileSync(path, `# Design Review: inventory grid

Reviewer: Demo Reviewer (agent)
Inputs: docs/design.md, docs/requirements.md
Date: 2026-09-30

## Verdict

approved-with-findings

One assumption was challenged and the design changed to cover diagonal placement. The deferred
finding is owned by the story that builds the map loader. Nothing remains open.

## Findings

| ID | Finding | Severity | Disposition | Reference |
| --- | --- | --- | --- | --- |
${row}

## Resolution

` + (row.includes('contested') ? `- DR-2: keep the current loader for now — resolved by Demo Owner\n` : '\n'));
  return path;
}

// ── The routes: one per gate, exactly the route that gate declares ─────────────

/**
 * Satisfy a gate through its documented route. Each entry is the route from the gate registry:
 * a project command (`harness verify`), a dedicated command whose artifact is checked, or a named
 * human record (`harness confirm`). Nothing here is a shortcut: the walk uses the same commands an
 * agent would, and every one of them has to succeed.
 */
async function satisfy(dir, gate, ctx) {
  // `--target` goes last: the CLI reads the command from the leading positionals.
  const at = (args) => run([...args, '--target', dir], repoRoot);
  switch (gate) {
    case 'testsPassed': {
      const r = await at(['harness', 'verify', '--gate', gate, '--command', 'node --test tests/inventory.test.mjs', '--format', 'json']);
      return { r, why: 'harness verify with a real test command' };
    }
    case 'acceptanceCriteriaValidated': {
      // Produce the report the gate reads, by running the tests, and keep it as evidence.
      const test = await new Promise((resolve) => {
        const child = spawn('node', ['--test', '--test-reporter=tap', 'tests/inventory.test.mjs'], { cwd: dir, windowsHide: true });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (status) => resolve({ status, out }));
      });
      writeFileSync(join(dir, 'reports', 'tap.txt'), test.out);
      const r = await at(['harness', 'verify-acs', '--story', 'stories/inventory-1.md', '--report', 'reports/tap.txt', '--format', 'json']);
      return { r, why: 'harness verify-acs against the report the tests produced' };
    }
    case 'reachabilityAddressed': {
      const r = await at(['harness', 'verify-reachability', '--story', 'stories/inventory-1.md', '--format', 'json']);
      return { r, why: "harness verify-reachability against the story's declaration" };
    }
    case 'designReviewCompleted': {
      const artifact = writeDesignReview(dir);
      const r = await at(['harness', 'verify-design-review', '--artifact', artifact, '--files', 'docs/design.md,docs/requirements.md', '--format', 'json']);
      return { r, why: 'harness verify-design-review against the reviewed artifact' };
    }
    case 'architectureFitnessPassed': {
      const r = await at(['harness', 'verify-architecture', '--format', 'json']);
      return { r, why: "the project's own declared architecture checks" };
    }
    case 'humanAcceptanceConfirmed': {
      const form = await at(['harness', 'acceptance-form', '--epic', 'INV-1']);
      if (form.status !== 0) return { r: form, why: 'harness acceptance-form' };
      const formPath = join(dir, '.cadet', 'agent', 'project-plans', 'INV-1', 'HumanAcceptance.md');
      // The three fields the generator leaves for a person. The walk fills them the way a person
      // would: the slot markers go, and real sentences take their place.
      const filled = readFileSync(formPath, 'utf-8')
        .replace(/<slot id="acceptor"[\s\S]*?\/>/, 'Demo Person (product owner)')
        .replace(/<slot id="witness"[\s\S]*?\/>/, 'Launched the demo scene, filled the grid, and watched the item count rise from 0 to 4 columns across 3 rows.')
        .replace(/<slot id="limitations"[\s\S]*?\/>/, 'none');
      writeFileSync(formPath, filled);
      const r = await at(['harness', 'confirm', '--gate', gate, '--artifact', formPath, '--reason', 'the demo walk was accepted', '--expires-at', EXPIRY, '--format', 'json']);
      return { r, why: 'the generated acceptance form, recorded by harness confirm' };
    }
    default: {
      // The gates whose automated path cannot exist everywhere: a judgement, or an editor this
      // environment does not have. `harness confirm` is their route, and the registry says so.
      const r = await at(['harness', 'confirm', '--gate', gate, '--reason', `${gate} verified by the named reviewer in the demo walk`, '--expires-at', EXPIRY, '--environment', 'host=demo', '--scope', 'INV-1', '--format', 'json']);
      return { r, why: 'harness confirm, the route the registry declares for this gate' };
    }
  }
}

async function cross(dir, to, { expectRefusal }) {
  // `--target` goes last: the CLI reads the command from the leading positionals.
  const at = (args) => run([...args, '--target', dir], repoRoot);
  let attempt = await at(['state', 'transition', '--to', to]);
  if (attempt.status === 0 && !expectRefusal) {
    pass(`→ ${to} (an ungated forward edge)`);
    return;
  }
  if (attempt.status === 0) {
    fail(`→ ${to} was expected to be refused`);
    return;
  }
  const gates = namedGates(attempt.text);
  const first = attempt.text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('❌')) || '';
  if (gates.length === 0) {
    fail(`→ ${to} refused without naming gates`, first);
    return;
  }
  pass(`→ ${to} refused`, `${gates.length} gate(s): ${gates.join(', ')}`);

  for (const gate of gates) {
    const { r, why } = await satisfy(dir, gate, {});
    if (r.status !== 0) {
      fail(`satisfy ${gate} via ${why}`, r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300));
    } else {
      pass(`satisfy ${gate}`, why);
    }
  }

  attempt = await at(['state', 'transition', '--to', to]);
  check(attempt.status === 0, `→ ${to} now opens`, attempt.status !== 0 ? attempt.text.slice(0, 200) : '');
}

// ── The walk ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('Gated walk — one work item, from clarification to human acceptance');
  const dir = buildFixture();
  console.log(`fixture: ${dir}\n`);
  // `--target` goes last: the CLI reads the command from the leading positionals.
  const at = (args) => run([...args, '--target', dir], repoRoot);

  try {
    console.log('── Setup');
    check((await at(['state', 'init', '--workflow-path', 'large'])).status === 0, 'state init');
    check((await at(['state', 'begin', '--epic', 'INV-1', '--story', 'stories/inventory-1.md'])).status === 0, 'state begin');
    {
      // `state.epics` is the planning index, and no command writes it: the framework reads it
      // (`resume`, `reconcile`, `acceptance-form`) and the agent maintains it during planning. The
      // walk registers the epic as fixture setup, and this is recorded as a limitation rather than
      // presented as a framework step.
      const statePath = join(dir, '.cadet', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      state.epics = { 'INV-1': { status: 'in-progress', stories: { 'inventory-1.md': 'in-progress' } } };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      pass('register the epic in state.epics', 'fixture setup: no command writes this index');
    }

    console.log('\n── Refusals that make the gates worth having');
    {
      const r = await at(['harness', 'confirm', '--gate', 'testsPassed', '--reason', 'I ran them myself', '--expires-at', EXPIRY, '--environment', 'host=demo', '--scope', 'INV-1', '--format', 'json']);
      check(r.status !== 0 && /disallowManualFor|manual/i.test(r.text), 'a passing test cannot be claimed by hand', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ').slice(0, 160));
    }
    {
      const r = await at(['harness', 'verify', '--gate', 'codeReviewCompleted', '--command', 'true', '--format', 'json']);
      check(r.status !== 0, 'a judgement gate takes no project command', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ').slice(0, 160));
    }
    {
      const r = await at(['harness', 'verify', '--gate', 'testsPassed', '--command', 'true', '--format', 'json']);
      check(r.status !== 0 || !/"ok":\s*true/.test(r.text), 'an exit-zero command is not a test run', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ').slice(0, 160));
    }
    {
      const artifact = writeDesignReview(dir, { row: '| DR-1 | No test names the rectangularity invariant. | low | maybe | — |' });
      const r = await at(['harness', 'verify-design-review', '--artifact', artifact, '--files', 'docs/design.md', '--format', 'json']);
      check(r.status !== 0, 'a design review with an unknown disposition is refused', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ').slice(0, 200));
    }
    {
      // The architecture constraint, really violated, in a copy of the tree.
      writeFileSync(join(dir, 'Assets', 'Scripts', 'Vendor.cs'), 'using DungeonArchitect; namespace Game { class Vendor {} }\n');
      const r = await at(['harness', 'verify-architecture', '--format', 'json']);
      check(r.status !== 0 && /no-vendor-dependency|forbidden/.test(r.text), 'a violated architecture constraint blocks, with the offender named', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 220));
      rmSync(join(dir, 'Assets', 'Scripts', 'Vendor.cs'));
    }
    {
      const r = await at(['harness', 'verify-reachability', '--story', 'stories/absent.md', '--format', 'json']);
      check(r.status !== 0, 'an undeclared reachability claim is refused', r.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ').slice(0, 160));
    }

    console.log('\n── The test first (red), then the implementation (green)');
    {
      const red = await at(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node --test tests/inventory.test.mjs', '--format', 'json']);
      check(red.status !== 0, 'the test fails before the implementation exists', red.text.replace(/\s+/g, ' ').slice(0, 120));
      // The implementation, now that the test describes it.
      writeFileSync(join(dir, 'Assets', 'Scripts', 'InventoryGrid.cs.mjs'),
        'export class InventoryGrid { constructor() { this.Columns = 4; this.Rows = 3; } }\n');
      pass('the implementation lands, after the test that describes it failed');
    }

    console.log('\n── The boundaries');
    await cross(dir, 'requirements', { expectRefusal: false });
    await cross(dir, 'architecture', { expectRefusal: false });
    await cross(dir, 'architectureComplete', { expectRefusal: false });
    await cross(dir, 'story-breakdown', { expectRefusal: true });
    await cross(dir, 'implementation', { expectRefusal: false });
    await cross(dir, 'review', { expectRefusal: true });
    await cross(dir, 'validation', { expectRefusal: true });
    await cross(dir, 'closed', { expectRefusal: true });

    console.log('\n── The sealed record');
    {
      const seal = await at(['state', 'seal']);
      check(seal.status === 0, 'state seal prepares the work item evidence for a commit', seal.text.split('\n').map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 120));
    }

    console.log('\n── The result');
    {
      const r = await at(['harness', 'report', '--format', 'json']);
      check(r.status === 0, 'harness report reads the finished work item');
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      check(state.session.currentPhase === 'closed', 'the work item reached "closed"', state.session.currentPhase);
      check(state.gates.humanAcceptanceConfirmed === true, 'human acceptance is recorded as satisfied');
    }
  } finally {
    if (keep) console.log(`\nkept: ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'Every expectation held.' : `${failures} expectation(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
