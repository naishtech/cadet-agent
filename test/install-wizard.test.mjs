import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  HOSTS, detectHosts, normalizeHostIds, normalizeEngines, componentsForChoice, parseNumberList,
  configureInstall, buildInstallRecord, readInstallRecord, writeInstallRecord,
  inferComponentsFromDisk, installRecordPath,
} from '../src/install.mjs';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMPONENTS = JSON.parse(readFileSync(join(REPO_ROOT, 'components.json'), 'utf-8'));

let work;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'cadet-wizard-'));
  mkdirSync(join(work, '.cadet', 'agent', 'core'), { recursive: true });
});
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

const write = (rel, body = 'x') => {
  const full = join(work, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
};

// ── Pure mappings ───────────────────────────────────────────────────────────

describe('host mapping', () => {
  it('lists the five hosts with a marker folder', () => {
    assert.deepEqual(HOSTS.map((h) => h.id), [
      'host.copilot', 'host.claude', 'host.agents', 'host.cursor', 'host.continue',
    ]);
  });

  it('accepts aliases and full ids, dropping the unknown', () => {
    assert.deepEqual(normalizeHostIds(['claude', 'hermes', 'host.cursor', 'notepad']),
      ['host.claude', 'host.agents', 'host.cursor']);
  });

  it('finds the hosts already present in a project', () => {
    mkdirSync(join(work, '.claude'));
    mkdirSync(join(work, '.github'));
    assert.deepEqual(detectHosts(work), ['host.copilot', 'host.claude']);
  });
});

describe('componentsForChoice', () => {
  it('always includes core', () => {
    assert.deepEqual(componentsForChoice({}), ['core']);
  });

  it('adds hosts and both engine products', () => {
    const ids = componentsForChoice({ hosts: ['host.claude'], engines: ['unity'] });
    assert.deepEqual(ids, ['core', 'host.claude', 'engine.unity.plugin', 'engine.unity.cli']);
  });

  it('leaves the engines out when plugins are declined', () => {
    const ids = componentsForChoice({ hosts: ['host.claude'], engines: ['unity'], plugins: false });
    assert.deepEqual(ids, ['core', 'host.claude']);
  });

  it('handles both engines', () => {
    const ids = componentsForChoice({ engines: ['unity', 'unreal'] });
    assert.equal(ids.filter((id) => id.startsWith('engine.')).length, 4);
  });
});

describe('answers', () => {
  it('maps engines by name', () => {
    assert.deepEqual(normalizeEngines('unity'), ['unity']);
    assert.deepEqual(normalizeEngines('BOTH'), ['unity', 'unreal']);
    assert.deepEqual(normalizeEngines('cryengine'), []);
    assert.deepEqual(normalizeEngines(''), []);
  });

  it('parses numbered answers, keeping the default on an empty line', () => {
    assert.deepEqual(parseNumberList('', 5, [1]), [1]);
    assert.deepEqual(parseNumberList('1, 4', 5), [0, 3]);
    assert.deepEqual(parseNumberList('none', 5, [0]), []);
    assert.deepEqual(parseNumberList('9', 5), []);
  });
});

// ── The wizard ──────────────────────────────────────────────────────────────

const scripted = (answers) => {
  const queue = [...answers];
  return async () => (queue.length ? queue.shift() : '');
};

describe('configureInstall', () => {
  it('installs everything when the archive has no manifest', async () => {
    const choice = await configureInstall(null, work, {});
    assert.equal(choice.components, null);
    assert.equal(choice.source, 'archive-defaults');
  });

  it('takes --components literally, with core added', async () => {
    const choice = await configureInstall(COMPONENTS, work, { components: ['host.claude'] });
    assert.deepEqual(choice.components, ['core', 'host.claude']);
    assert.equal(choice.source, 'components-flag');
  });

  it('honours --hosts and --engine without asking anything', async () => {
    const choice = await configureInstall(COMPONENTS, work, { hosts: ['hermes'], engine: 'unreal' });
    assert.deepEqual(choice.components,
      ['core', 'engine.unreal.cli', 'engine.unreal.plugin', 'host.agents']);
    assert.equal(choice.source, 'flags');
  });

  it('honours --no-plugins', async () => {
    const choice = await configureInstall(COMPONENTS, work, { hosts: ['claude'], plugins: false });
    assert.deepEqual(choice.components, ['core', 'host.claude']);
  });

  it('falls back to detection when it cannot prompt', async () => {
    write('ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.62f3\n');
    mkdirSync(join(work, '.claude'));
    const choice = await configureInstall(COMPONENTS, work, { yes: true });
    assert.deepEqual(choice.components,
      ['core', 'engine.unity.cli', 'engine.unity.plugin', 'host.claude']);
    assert.equal(choice.source, 'detected');
  });

  it('walks the four questions and uses the answers', async () => {
    const ask = scripted(['2', 'unity', '', '']);   // Claude Code, Unity, plugins yes, confirm yes
    const choice = await configureInstall(COMPONENTS, work, { interactive: true, ask });
    assert.deepEqual(choice.components,
      ['core', 'engine.unity.cli', 'engine.unity.plugin', 'host.claude']);
    assert.equal(choice.source, 'wizard');
    assert.equal(choice.cancelled, undefined);
  });

  it('stops when the summary is declined', async () => {
    const ask = scripted(['1', 'both', '', 'n']);
    const choice = await configureInstall(COMPONENTS, work, { interactive: true, ask });
    assert.equal(choice.cancelled, true);
    assert.deepEqual(choice.hosts, ['host.copilot']);
    assert.deepEqual(choice.engines, ['unity', 'unreal']);
  });
});

// ── The install record ──────────────────────────────────────────────────────

describe('install record', () => {
  it('hashes every file it names, and remembers the targets', () => {
    const a = write('.cadet/agent/core/cadet-agent.md', 'agent');
    const b = write('Assets/Covyne/Cadet/Editor/Window.cs', 'code');
    const record = buildInstallRecord({
      targetDir: work,
      version: '0.70.0',
      components: ['core', 'engine.unity.plugin'],
      engine: { engines: ['unity'] },
      written: [a, b],
      manifest: COMPONENTS,
    });

    assert.equal(record.schemaVersion, 1);
    assert.equal(record.suiteVersion, '0.70.0');
    assert.deepEqual(record.components, ['core', 'engine.unity.plugin']);
    assert.deepEqual(record.engine, { primary: 'unity', secondary: null });
    assert.deepEqual(record.targets, { unity: { pluginRoot: 'Assets/Covyne/Cadet' } });
    assert.ok(record.dirs.includes('Assets/Covyne/Cadet'));

    const byPath = Object.fromEntries(record.files.map((f) => [f.path, f]));
    assert.equal(byPath['.cadet/agent/core/cadet-agent.md'].sha256,
      createHash('sha256').update('agent').digest('hex'));
    assert.equal(byPath['.cadet/agent/core/cadet-agent.md'].component, 'core');
    assert.equal(byPath['Assets/Covyne/Cadet/Editor/Window.cs'].component, 'engine.unity.plugin');
  });

  it('attributes a host file to its host, not to core', () => {
    const a = write('.claude/skills/cadet-agent/SKILL.md', 'skill');
    const record = buildInstallRecord({
      targetDir: work, version: '0.70.0', components: ['core', 'host.claude'],
      engine: { engines: [] }, written: [a], manifest: COMPONENTS,
    });
    assert.equal(record.files[0].component, 'host.claude');
  });

  it('round-trips through the file, and merges a later sync', () => {
    const a = write('.cadet/agent/core/cadet-agent.md', 'v1');
    const first = buildInstallRecord({
      targetDir: work, version: '0.70.0', components: ['core'],
      engine: { engines: [] }, written: [a], manifest: COMPONENTS,
    });
    writeInstallRecord(work, first);
    assert.equal(readInstallRecord(work).files.length, 1);

    // A sync writes a second file and changes the first.
    const b = write('.cadet/agent/core/Harness.md', 'harness');
    writeFileSync(a, 'v2');
    const second = buildInstallRecord({
      targetDir: work, version: '0.71.0', components: ['core'],
      engine: { engines: [] }, written: [a, b], manifest: COMPONENTS, previous: first,
    });
    assert.equal(second.files.length, 2);
    assert.equal(second.files.find((f) => f.path.endsWith('cadet-agent.md')).sha256,
      createHash('sha256').update('v2').digest('hex'));
    assert.equal(second.suiteVersion, '0.71.0');
  });

  it('drops entries for files that no longer exist', () => {
    const a = write('.cadet/agent/core/cadet-agent.md', 'x');
    const first = buildInstallRecord({
      targetDir: work, version: '0.70.0', components: ['core'],
      engine: { engines: [] }, written: [a], manifest: COMPONENTS,
    });
    rmSync(a);
    const second = buildInstallRecord({
      targetDir: work, version: '0.71.0', components: ['core'],
      engine: { engines: [] }, written: [], manifest: COMPONENTS, previous: first,
    });
    assert.deepEqual(second.files, []);
  });

  it('writes to .cadet/agent/install.json', () => {
    assert.equal(installRecordPath(work), join(work, '.cadet', 'agent', 'install.json'));
  });

  it('infers a component set from what is on disk', () => {
    mkdirSync(join(work, '.claude'));
    write('Assets/Covyne/Cadet/CLI/dist.sh', '#!/bin/bash');
    write('Plugins/CadetBuild/CadetBuild.uplugin', '{}');
    assert.deepEqual(inferComponentsFromDisk(work), [
      'core', 'host.claude', 'engine.unity.plugin', 'engine.unity.cli',
      'engine.unreal.plugin',
    ]);
  });
});
