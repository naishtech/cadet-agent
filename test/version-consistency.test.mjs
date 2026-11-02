/**
 * One suite version, in every file that carries one.
 *
 * A bump that misses a file is silent: the npm package says 0.64.0, the Unreal
 * plugin descriptor still says 0.1.0, and nothing fails until a consumer asks
 * which version they have. This test is the cheap gate a release has to pass
 * before any artifact is built.
 *
 * The four files are the ones plan 01 §5 names. `ADAPTERS.md` also quotes the
 * framework version, but it is prose read by a person, not read by code, so a
 * drift there is a documentation defect and not a version split.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));

describe('one version across the suite', () => {
  it('every file that carries the suite version carries the same one', () => {
    const suiteVersion = readJson('package.json').version;

    const carried = {
      'package.json': suiteVersion,
      '.cadet/agent/core/FrameworkManifest.json': readJson('.cadet/agent/core/FrameworkManifest.json').frameworkVersion,
      'packages/cli/VERSION': readFileSync(join(repoRoot, 'packages/cli/VERSION'), 'utf8').trim(),
      'packages/unreal/CadetBuild.uplugin': readJson('packages/unreal/CadetBuild.uplugin').VersionName,
    };

    const drifted = Object.entries(carried).filter(([, value]) => value !== suiteVersion);
    assert.deepEqual(
      drifted,
      [],
      `these files do not carry ${suiteVersion}: ${drifted.map(([file, value]) => `${file} = ${value}`).join(', ')}`,
    );
  });
});
