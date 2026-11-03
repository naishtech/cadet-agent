/**
 * `sync` may change only what the install record proves.
 *
 * The failure this suite exists for: a Unity consumer with hand-installed
 * `.github`, `.cursor` and `.continue` adapters had no install record, so `sync`
 * inferred a component set from those marker folders and wrote them again. A
 * marker folder on disk is not evidence that this install wrote it, and sync has
 * no business changing the shape of a project nobody asked to change.
 *
 * The release fetch is stubbed, so these tests never touch the network.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMinimalZip } from './helpers/zip.mjs';
import { sync, installRecordPath } from '../src/install.mjs';

const ZIP_NAME = 'cadet-agent.zip';
const RELEASE_URL = 'https://example.test/latest.json';

/** A release zip that carries a `host.cursor` component the record does not own. */
function releaseZip() {
  const components = {
    suiteVersion: '9.9.9',
    components: [
      { id: 'core', zipPaths: ['.cadet/agent/core/'], installTo: '.', required: true },
      { id: 'host.cursor', zipPaths: ['.cursor/'], installTo: '.' },
    ],
  };
  const manifest = {
    frameworkName: 'Cadet-Agent',
    frameworkVersion: '9.9.9',
    managedPaths: ['.cadet/agent/core'],
    preservedPaths: [],
  };
  return buildMinimalZip([
    { name: 'components.json', content: JSON.stringify(components) },
    { name: '.cadet/agent/core/FrameworkManifest.json', content: JSON.stringify(manifest) },
    { name: '.cadet/agent/core/cadet-agent.md', content: '# directive v9.9.9\n' },
    { name: '.cursor/rules/cadet-agent.md', content: '# a cursor adapter\n' },
  ]);
}

let work;
let originalFetch;
let originalExitCode;

function stubRelease(zip) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('latest.json')) {
      return new Response(JSON.stringify({
        tag_name: 'v9.9.9',
        published_at: '2026-11-03T00:00:00Z',
        assets: [{ name: ZIP_NAME, browser_download_url: 'https://example.test/cadet-agent.zip' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(zip, { status: 200 });
  };
}

/** An existing install: the manifest is on disk but no record was ever written. */
function legacyInstall({ withRecord = false, withMarkerDirs = true } = {}) {
  mkdirSync(join(work, '.cadet/agent/core'), { recursive: true });
  writeFileSync(join(work, '.cadet/agent/core/FrameworkManifest.json'), JSON.stringify({
    frameworkName: 'Cadet-Agent',
    frameworkVersion: '0.1.0',
    managedPaths: ['.cadet/agent/core'],
    preservedPaths: [],
  }));
  writeFileSync(join(work, '.cadet/agent/core/cadet-agent.md'), '# directive v0.1.0\n');
  if (withMarkerDirs) {
    for (const dir of ['.github/agents', '.cursor/rules', '.continue/rules', '.claude/skills']) {
      mkdirSync(join(work, dir), { recursive: true });
    }
    mkdirSync(join(work, 'Plugins/CadetBuild'), { recursive: true });
    writeFileSync(join(work, 'Plugins/CadetBuild/CadetBuild.uplugin'), '{}');
  }
  if (withRecord) {
    const rel = '.cadet/agent/core/cadet-agent.md';
    mkdirSync(join(work, '.cadet/agent'), { recursive: true });
    writeFileSync(installRecordPath(work), JSON.stringify({
      schemaVersion: 1,
      suiteVersion: '0.1.0',
      installedAt: '2026-11-03T00:00:00Z',
      components: ['core'],
      engine: { primary: 'unity', secondary: null },
      targets: {},
      dirs: ['.cadet/agent/core'],
      files: [{
        path: rel,
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        component: 'core',
      }],
    }, null, 2));
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'cadet-sync-record-'));
  originalFetch = globalThis.fetch;
  originalExitCode = process.exitCode;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.exitCode = originalExitCode;
  rmSync(work, { recursive: true, force: true });
});

describe('sync without an install record', () => {
  it('refuses instead of inferring components from marker folders', async () => {
    legacyInstall({ withRecord: false, withMarkerDirs: true });
    stubRelease(releaseZip());

    await sync(work, { sourceUrl: RELEASE_URL });

    assert.equal(process.exitCode, 1, 'sync must exit non-zero rather than guess');
    assert.equal(existsSync(join(work, '.cursor/rules/cadet-agent.md')), false,
      'nothing from a component the record does not name may be written');
    assert.equal(existsSync(join(work, '.cadet/engine.json')), false,
      'a refused sync writes no engine seam either');
    assert.equal(existsSync(join(work, '.cadet/.repo-role')), false);
    assert.equal(readFileSync(join(work, '.cadet/agent/core/cadet-agent.md'), 'utf-8'), '# directive v0.1.0\n');
  });
});

describe('sync with an install record', () => {
  it('installs the recorded components and never adds a host it finds on disk', async () => {
    legacyInstall({ withRecord: true, withMarkerDirs: true });
    stubRelease(releaseZip());

    await sync(work, { sourceUrl: RELEASE_URL });

    assert.notEqual(process.exitCode, 1);
    assert.equal(existsSync(join(work, '.cursor/rules/cadet-agent.md')), false,
      'a .cursor marker folder on disk is not a component this install wrote');
    assert.equal(readFileSync(join(work, '.cadet/agent/core/cadet-agent.md'), 'utf-8'), '# directive v9.9.9\n',
      'the recorded component was updated');
    const record = JSON.parse(readFileSync(join(work, '.cadet/agent/install.json'), 'utf-8'));
    assert.deepEqual(record.components, ['core'], 'the record is not widened');
    assert.equal(record.engine.primary, 'unity', 'the recorded engine survives, with no detection');
  });
});
