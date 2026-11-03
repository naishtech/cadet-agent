/**
 * The Unreal plugin must not name a game project.
 *
 * The plugin was lifted out of one game project. These checks keep it independent:
 * a game name that leaks back in, a vendored CLI copy, or an automation test that
 * would not answer to the `Automation RunTests Cadet` filter.
 *
 * PROVENANCE.md is excluded: D9 requires it to name the source repository.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repoRoot = join(here, '..');
const pluginRoot = join(repoRoot, 'packages', 'unreal');

const SOURCE_EXTENSIONS = new Set(['.cpp', '.h', '.cs', '.ini', '.uplugin', '.md']);

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

describe('unreal plugin guard', () => {
  it('names no game project', () => {
    const offenders = [];
    for (const file of walk(pluginRoot)) {
      if (!SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf('.')))) continue;
      if (relative(pluginRoot, file) === 'PROVENANCE.md') continue;
      const text = readFileSync(file, 'utf-8');
      if (/Bloodstone/.test(text)) offenders.push(relative(repoRoot, file));
    }
    assert.deepEqual(offenders, [], `a game name is back in: ${offenders.join(', ')}`);
  });

  it('carries no vendored copy of the CLI', () => {
    assert.equal(existsSync(join(pluginRoot, 'CLI')), false, 'packages/unreal/CLI exists; the installer writes the CLI, not git');
  });

  it('names every automation test Cadet.*, so one filter finds them all', () => {
    const names = [];
    for (const file of walk(pluginRoot)) {
      if (!file.endsWith('.cpp')) continue;
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(/IMPLEMENT_(?:SIMPLE|COMPLEX|FAKE)_AUTOMATION_TEST\(\s*\w+\s*,\s*"([^"]+)"/g)) {
        names.push(match[1]);
      }
    }
    assert.ok(names.length > 0, 'no automation tests found');
    const stray = names.filter((name) => !name.startsWith('Cadet.'));
    assert.deepEqual(stray, [], `these tests do not answer to RunTests Cadet: ${stray.join(', ')}`);
  });
});
