import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

import { crc32 } from '../src/harness/archive.mjs';
import {
  readComponentsFromZip, selectComponents, buildExtractionRules, findRule, mapComponentPath,
  extractZip, detectProject, detectUnrealProject, COMPONENTS_FILE,
} from '../src/install.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMPONENTS = JSON.parse(readFileSync(join(REPO_ROOT, COMPONENTS_FILE), 'utf-8'));
const FRAMEWORK = JSON.parse(readFileSync(join(REPO_ROOT, '.cadet/agent/core/FrameworkManifest.json'), 'utf-8'));

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Build a stored-mode ZIP. Small on purpose: the tests need entry names, not compression. */
function buildZip(files) {
  const parts = [];
  const cd = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.from(file.content ?? '', 'utf-8');
    const name = Buffer.from(file.name, 'utf-8');
    const lfh = Buffer.alloc(30 + name.length);
    lfh.writeUInt32LE(SIG_LFH, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc32(raw), 14);
    lfh.writeUInt32LE(raw.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    name.copy(lfh, 30);
    parts.push(lfh, raw);

    const cdr = Buffer.alloc(46 + name.length);
    cdr.writeUInt32LE(SIG_CD, 0);
    cdr.writeUInt16LE(20, 4);
    cdr.writeUInt16LE(20, 6);
    cdr.writeUInt32LE(crc32(raw), 16);
    cdr.writeUInt32LE(raw.length, 20);
    cdr.writeUInt32LE(raw.length, 24);
    cdr.writeUInt16LE(name.length, 28);
    cdr.writeUInt32LE(offset, 42);
    name.copy(cdr, 46);
    cd.push(cdr);

    offset += lfh.length + raw.length;
  }
  const central = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(cd.length, 8);
  eocd.writeUInt16LE(cd.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, eocd]);
}

const has = (dir, rel) => existsSync(join(dir, rel.split('/').join('/')));

function makePackageZip() {
  return buildZip([
    { name: COMPONENTS_FILE, content: JSON.stringify(COMPONENTS) },
    { name: '.cadet/agent/core/cadet-agent.md', content: '# agent' },
    { name: '.cadet/agent/core/FrameworkManifest.json', content: JSON.stringify({ createOnlyPaths: [] }) },
    { name: 'AGENTS.md', content: '# agents' },
    { name: '.github/agents/cadet.agent.md', content: '# copilot' },
    { name: '.claude/skills/cadet-agent/SKILL.md', content: '# claude' },
    { name: 'packages/unity/Editor/Example.cs', content: 'class Example {}' },
    { name: 'packages/unity/Tests/EditMode/ExampleTests.cs', content: 'class ExampleTests {}' },
    { name: 'packages/unity/PROVENANCE.md', content: '# provenance' },
    { name: 'packages/cli/dist.sh', content: '#!/bin/bash' },
    { name: 'packages/unreal/CadetBuild.uplugin', content: '{}' },
  ]);
}

let work;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'cadet-components-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

// ── The authored manifest ───────────────────────────────────────────────────

describe('components.json', () => {
  it('has unique ids', () => {
    const ids = COMPONENTS.components.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('names only zip paths that exist in this repository', () => {
    const missing = [];
    for (const c of COMPONENTS.components) {
      for (const p of c.zipPaths) {
        if (!existsSync(join(REPO_ROOT, p.replace(/\/$/, '')))) missing.push(`${c.id}: ${p}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('agrees with FrameworkManifest managedPaths: every managed file belongs to a component', () => {
    const rules = buildExtractionRules(COMPONENTS.components);
    const orphans = FRAMEWORK.managedPaths.filter((m) => mapComponentPath(m, rules) === null);
    assert.deepEqual(orphans, []);
  });
});

describe('selectComponents', () => {
  it('selects every component when nothing is named', () => {
    const all = selectComponents(COMPONENTS, {});
    assert.equal(all.length, COMPONENTS.components.length);
  });

  it('always keeps a required component', () => {
    const selected = selectComponents(COMPONENTS, { components: ['host.claude'] });
    assert.deepEqual(selected.map((c) => c.id).sort(), ['core', 'host.claude']);
  });

  it('rejects an unknown id', () => {
    assert.throws(() => selectComponents(COMPONENTS, { components: ['host.notepad'] }), /unknown component/);
  });

  it('rejects a component whose requirement is not selected', () => {
    assert.throws(() => selectComponents(COMPONENTS, { components: ['engine.unity.cli'] }), /requires engine\.unity\.plugin/);
  });
});

// ── Extraction ──────────────────────────────────────────────────────────────

describe('component extraction', () => {
  it('reads the manifest out of the archive', () => {
    const manifest = readComponentsFromZip(makePackageZip());
    assert.equal(manifest.components.length, COMPONENTS.components.length);
  });

  it('installs core only, and nothing from a host or an engine', async () => {
    await extractZip(makePackageZip(), work, { components: ['core'] });
    assert.ok(has(work, '.cadet/agent/core/cadet-agent.md'));
    assert.ok(has(work, 'AGENTS.md'));
    assert.equal(has(work, '.github/agents/cadet.agent.md'), false);
    assert.equal(has(work, '.claude/skills/cadet-agent/SKILL.md'), false);
    assert.equal(has(work, 'packages/unity/Editor/Example.cs'), false);
  });

  it('installs a named host beside core', async () => {
    await extractZip(makePackageZip(), work, { components: ['core', 'host.copilot'] });
    assert.ok(has(work, '.github/agents/cadet.agent.md'));
    assert.equal(has(work, '.claude/skills/cadet-agent/SKILL.md'), false);
  });

  it('maps the Unity tooling into Assets/Covyne/Cadet and drops PROVENANCE.md and Tests', async () => {
    await extractZip(makePackageZip(), work, { components: ['engine.unity.plugin', 'engine.unity.cli'] });
    assert.ok(has(work, 'Assets/Covyne/Cadet/Editor/Example.cs'));
    assert.ok(has(work, 'Assets/Covyne/Cadet/CLI/dist.sh'));
    assert.equal(has(work, 'Assets/Covyne/Cadet/PROVENANCE.md'), false);
    assert.equal(has(work, 'Assets/Covyne/Cadet/Tests/EditMode/ExampleTests.cs'), false);
    assert.equal(has(work, 'packages/unity/Editor/Example.cs'), false);
  });

  it('maps the Unreal plugin into Plugins/CadetBuild', async () => {
    await extractZip(makePackageZip(), work, { components: ['engine.unreal.plugin', 'engine.unreal.cli'] });
    assert.ok(has(work, 'Plugins/CadetBuild/CadetBuild.uplugin'));
    assert.ok(has(work, 'Plugins/CadetBuild/CLI/dist.sh'));
  });

  it('fails rather than half-installing an unknown component', async () => {
    await assert.rejects(() => extractZip(makePackageZip(), work, { components: ['engine.mobile'] }), /unknown component/);
  });
});

// ── Project detection ───────────────────────────────────────────────────────

describe('detectProject', () => {
  it('reports a Unity project', () => {
    mkdirSync(join(work, 'ProjectSettings'), { recursive: true });
    writeFileSync(join(work, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.62f3\n');
    const found = detectProject(work);
    assert.equal(found.engine, 'unity');
    assert.deepEqual(found.engines, ['unity']);
  });

  it('reports an Unreal project from its .uproject', () => {
    writeFileSync(join(work, 'MyGame.uproject'), '{}');
    const found = detectProject(work);
    assert.equal(found.engine, 'unreal');
    assert.equal(found.unreal.marker, 'MyGame.uproject');
  });

  it('reports an Unreal project from Source plus Config', () => {
    mkdirSync(join(work, 'Source'), { recursive: true });
    mkdirSync(join(work, 'Config'), { recursive: true });
    writeFileSync(join(work, 'Config', 'DefaultEngine.ini'), '[/Script/EngineSettings.GameMapsSettings]\n');
    assert.equal(detectUnrealProject(work).confidence, 'medium');
  });

  it('reports both, and neither', () => {
    mkdirSync(join(work, 'ProjectSettings'), { recursive: true });
    writeFileSync(join(work, 'ProjectSettings', 'ProjectVersion.txt'), 'x\n');
    writeFileSync(join(work, 'MyGame.uproject'), '{}');
    assert.equal(detectProject(work).engine, 'both');

    const empty = mkdtempSync(join(tmpdir(), 'cadet-empty-'));
    try {
      assert.equal(detectProject(empty).engine, null);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
