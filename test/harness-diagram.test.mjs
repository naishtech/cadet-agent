import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  scanPackages, scanComponents, componentEdges,
  indexComponents, componentStatusMap, buildDiagramModel, buildStructureModel, renderNoml, renderNomlSvg,
  STATUS_COLORS,
} from '../src/harness/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const fixtureDir = join(here, 'fixtures', 'csharp-packages');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', windowsHide: true });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* a human-format invocation has none */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A state document with one epic whose two stories touch two components. */
function stateDoc() {
  return {
    version: 4,
    stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1-combat', storyId: 'story-1.md' },
    epics: {
      'epic-1-combat': { status: 'in-progress', stories: { 'story-1.md': 'done', 'story-2.md': 'in-progress' } },
      'epic-2-idle': { status: 'planned', stories: { 'story-1.md': 'planned' } },
    },
    gates: {},
    gateEvidence: [
      { workItemId: 'epic-1-combat::story-1.md', relevantFiles: ['Cadet.Core/Combat/CombatService.cs'] },
      { workItemId: 'epic-1-combat::story-2.md', relevantFiles: ['Cadet.Core/Inventory/InventoryService.cs'] },
    ],
    gateExceptions: [],
  };
}

/** A temp project: the C# fixture at the root, plus a state document. */
function makeProject({ withState = true } = {}) {
  const dir = tempDir('cadet-diagram-');
  cpSync(join(fixtureDir, 'Cadet.Core'), join(dir, 'Cadet.Core'), { recursive: true });
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  if (withState) writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(stateDoc(), null, 2));
  return dir;
}

describe('C# package and component scan', () => {
  it('discovers asmdef packages, resolves named references, and flags test assemblies', () => {
    const packages = scanPackages(fixtureDir);
    assert.deepEqual(packages.map((p) => p.id), ['Cadet.Core', 'Cadet.Sample', 'Cadet.Tests.Core']);
    assert.deepEqual(packages.find((p) => p.id === 'Cadet.Sample').references, ['Cadet.Core']);
    assert.equal(packages.find((p) => p.id === 'Cadet.Tests.Core').isTest, true);
    assert.equal(packages.find((p) => p.id === 'Cadet.Core').isTest, false);
  });

  it('groups a package into components by namespace, and derives using-edges', () => {
    const packages = scanPackages(fixtureDir);
    const core = packages.find((p) => p.id === 'Cadet.Core');
    const components = scanComponents(core, { packages });
    assert.deepEqual(
      components.map((c) => c.namespace),
      ['Cadet.Core.Combat', 'Cadet.Core.Inventory', 'Cadet.Core.Persistence'],
    );
    assert.deepEqual(componentEdges(components), [
      { from: 'Cadet.Core.Combat', to: 'Cadet.Core.Inventory', kind: 'uses' },
    ]);
  });

  it('falls back to top-level folders when no asmdef exists', () => {
    const dir = tempDir('cadet-plain-cs-');
    try {
      mkdirSync(join(dir, 'Gameplay'), { recursive: true });
      writeFileSync(join(dir, 'Gameplay', 'Actor.cs'), 'namespace Gameplay { class Actor {} }\n');
      const packages = scanPackages(dir);
      assert.deepEqual(packages.map((p) => p.id), ['Gameplay']);
      assert.deepEqual(scanComponents(packages[0]).map((c) => c.namespace), ['Gameplay']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('maps a using to the longest PREFIX namespace, never a longer sibling', () => {
    // Regression, caught on a real project that has both `…Rendering` and
    // `…Rendering.Crowd`: `using …Rendering;` must not resolve to the longer sibling.
    const dir = tempDir('cadet-ns-prefix-');
    try {
      const write = (rel, body) => {
        const path = join(dir, rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, body);
        return path;
      };
      const components = [
        { id: 'A.B', namespace: 'A.B', files: [write('ab/F.cs', 'namespace A.B { class F {} }\n')] },
        { id: 'A.B.C', namespace: 'A.B.C', files: [write('abc/G.cs', 'namespace A.B.C { class G {} }\n')] },
        { id: 'Z', namespace: 'Z', files: [write('z/H.cs', 'using A.B;\nnamespace Z { class H {} }\n')] },
      ];
      assert.deepEqual(componentEdges(components), [{ from: 'Z', to: 'A.B', kind: 'uses' }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('progress attribution', () => {
  it('colours each component by the stories whose evidence files land in it', () => {
    const packages = scanPackages(fixtureDir);
    const { byFile, componentsByPkg, edgesByPkg } = indexComponents(fixtureDir, packages);
    const core = packages.find((p) => p.id === 'Cadet.Core');
    const workItemFiles = new Map([
      ['epic-1-combat::story-1.md', new Set(['Cadet.Core/Combat/CombatService.cs'])],
      ['epic-1-combat::story-2.md', new Set(['Cadet.Core/Inventory/InventoryService.cs'])],
    ]);

    const model = buildDiagramModel({
      pkg: core,
      epicId: 'epic-1-combat',
      state: stateDoc(),
      components: componentsByPkg.get('Cadet.Core'),
      edges: edgesByPkg.get('Cadet.Core'),
      byFile,
      workItemFiles,
      allPackages: packages,
    });

    const status = Object.fromEntries(model.components.map((c) => [c.id, c.status]));
    assert.equal(status['Cadet.Core.Combat'], 'done', 'a story that is done makes its component green');
    assert.equal(status['Cadet.Core.Inventory'], 'in-progress', 'a story still in progress makes its component amber');
    assert.equal(model.components.some((c) => c.id === 'Cadet.Core.Persistence'), false, 'untouched, non-neighbour components are out of scope');
    assert.equal(model.elided.count, 1);
  });

  it('shows every component red when there is no work record', () => {
    const packages = scanPackages(fixtureDir);
    const { componentsByPkg, edgesByPkg } = indexComponents(fixtureDir, packages);
    const core = packages.find((p) => p.id === 'Cadet.Core');
    const model = buildStructureModel({
      pkg: core,
      components: componentsByPkg.get('Cadet.Core'),
      edges: edgesByPkg.get('Cadet.Core'),
      allPackages: packages,
    });
    assert.equal(model.components.length, 3);
    assert.ok(model.components.every((c) => c.status === 'not-started'));
  });

  it('colours a component by all its work, not only the current epic', () => {
    // Regression from a real project: a component finished in an earlier epic
    // read red in a later epic's diagram, because colour came from that epic alone.
    const packages = scanPackages(fixtureDir);
    const { byFile, componentsByPkg, edgesByPkg } = indexComponents(fixtureDir, packages);
    const core = packages.find((p) => p.id === 'Cadet.Core');
    const state = {
      epics: {
        'epic-1': { status: 'complete', stories: { 's1.md': 'done' } },
        'epic-2': { status: 'in-progress', stories: { 's1.md': 'in-progress' } },
      },
    };
    const workItemFiles = new Map([
      ['epic-1::s1.md', new Set(['Cadet.Core/Combat/CombatService.cs'])],
      ['epic-2::s1.md', new Set(['Cadet.Core/Inventory/InventoryService.cs'])],
    ]);
    const model = buildDiagramModel({
      pkg: core,
      epicId: 'epic-2',
      state,
      components: componentsByPkg.get('Cadet.Core'),
      edges: edgesByPkg.get('Cadet.Core'),
      byFile,
      workItemFiles,
      allPackages: packages,
      componentStatus: componentStatusMap({ state, byFile, workItemFiles }),
    });
    const status = Object.fromEntries(model.components.map((c) => [c.id, c.status]));
    assert.equal(status['Cadet.Core.Inventory'], 'in-progress', "epic-2's own component");
    assert.equal(status['Cadet.Core.Combat'], 'done', 'finished in epic-1, so green in epic-2 too');
  });
});

describe('UML source', () => {
  it('is deterministic and carries the frame, the classifier styles and the edges', () => {
    const model = {
      package: { id: 'P', name: 'P' },
      epic: { id: 'e', status: 'planned' },
      components: [
        { id: 'B', name: 'B', namespace: 'B', status: 'in-progress' },
        { id: 'A', name: 'A', namespace: 'A', status: 'done' },
      ],
      edges: [{ from: 'A', to: 'B', kind: 'uses' }],
      external: [],
      elided: { count: 2, names: [] },
      legend: {},
    };
    const expected = [
      '#direction: right',
      `#.notstarted: fill=${STATUS_COLORS['not-started']}`,
      `#.inprogress: fill=${STATUS_COLORS['in-progress']}`,
      `#.done: fill=${STATUS_COLORS.done}`,
      '[<frame>P|',
      '  [<done> A]',
      '  [<inprogress> B]',
      '  [A] uses --> [B]',
      ']',
      '// elided 2 component(s) touched by no story and no 1-hop dependency',
      '',
    ].join('\n');

    assert.equal(renderNoml(model), expected);
    assert.equal(renderNoml(model), renderNoml(model), 'the same model must render the same text');
  });

  it('renders to an SVG that names every component and paints each status', () => {
    const model = {
      package: { id: 'P', name: 'P' },
      epic: { id: 'e', status: 'planned' },
      components: [
        { id: 'A', name: 'A', namespace: 'A', status: 'done' },
        { id: 'B', name: 'B', namespace: 'B', status: 'not-started' },
      ],
      edges: [],
      external: [],
      elided: { count: 0, names: [] },
      legend: {},
    };
    const svg = renderNomlSvg(renderNoml(model));
    assert.match(svg, /^<svg/);
    // Reacting to the frame nesting: nomnoml attaches `data-name` to the outer
    // frame group, so the components are asserted as text, not as attributes.
    for (const name of ['A', 'B']) assert.ok(svg.includes(`>${name}</text>`), `${name} must appear in the diagram`);
    assert.ok(svg.includes(STATUS_COLORS.done));
    assert.ok(svg.includes(STATUS_COLORS['not-started']));
    assert.equal(svg, renderNomlSvg(renderNoml(model)), 'nomnoml output must be deterministic for a fixed input');
  });
});

describe('harness diagram (CLI)', () => {
  it('writes a diagram per package × epic and links the packages from the root index', () => {
    const dir = makeProject();
    try {
      const r = runCli(['harness', 'diagram', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.diagrams, 1, 'only the epic with evidence yields a diagram');
      assert.ok(existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Core', 'epic-1-combat.noml')));
      assert.ok(existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Core', 'epic-1-combat.svg')));

      const index = readFileSync(join(dir, '.cadet', 'diagrams', 'index.html'), 'utf-8');
      assert.ok(index.includes('Cadet.Core/index.html'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('renders structure only, with a warning, when there is no state', () => {
    const dir = makeProject({ withState: false });
    try {
      const r = runCli(['harness', 'diagram', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.json.warning, 'the run must say why every component is red');
      assert.ok(existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Core', 'structure.noml')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes nothing under --dry-run', () => {
    const dir = makeProject();
    try {
      const before = readdirSync(dir).sort();
      const r = runCli(['harness', 'diagram', '--target', dir, '--dry-run', '--format', 'json']);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(readdirSync(dir).sort(), before);
      assert.ok(!existsSync(join(dir, '.cadet', 'diagrams')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('excludes test assemblies by default, and includes them with --include-tests', () => {
    const dir = tempDir('cadet-diagram-tests-');
    try {
      const base = runCli(['harness', 'diagram', '--target', dir, '--cs-root', fixtureDir, '--out', join(dir, 'a'), '--format', 'json']);
      assert.equal(base.status, 0, base.stderr);
      const ids = base.json.packages.map((p) => p.id);
      assert.ok(ids.includes('Cadet.Core'));
      assert.ok(!ids.includes('Cadet.Tests.Core'), 'a test assembly is excluded by default');

      const withTests = runCli(['harness', 'diagram', '--target', dir, '--cs-root', fixtureDir, '--out', join(dir, 'b'), '--include-tests', '--format', 'json']);
      assert.equal(withTests.status, 0, withTests.stderr);
      assert.ok(withTests.json.packages.map((p) => p.id).includes('Cadet.Tests.Core'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('prunes the files a previous run wrote and this one did not', () => {
    // A re-run without test assemblies must remove the ones an earlier run wrote,
    // or the tree claims packages the model no longer has.
    const dir = makeProject({ withState: false });
    try {
      const first = runCli(['harness', 'diagram', '--target', dir, '--cs-root', fixtureDir, '--include-tests', '--format', 'json']);
      assert.equal(first.status, 0, first.stderr);
      assert.ok(existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Tests.Core', 'structure.noml')));

      const second = runCli(['harness', 'diagram', '--target', dir, '--cs-root', fixtureDir, '--format', 'json']);
      assert.equal(second.status, 0, second.stderr);
      assert.ok(second.json.removed > 0, 'the files the test assembly owned are pruned');
      assert.ok(!existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Tests.Core')), 'the stale directory is gone');
      assert.ok(existsSync(join(dir, '.cadet', 'diagrams', 'Cadet.Core', 'structure.noml')), 'kept files survive');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
