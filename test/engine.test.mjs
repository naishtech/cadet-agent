import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CAPABILITIES, ENGINE_FILE_REL, INIT_COMMAND,
  commandFor, readEngine, resolveEngines, writeEngine,
} from '../src/harness/engine.mjs';

let work;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'cadet-engine-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

function file(rel, body) {
  const full = join(work, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function writeEngineFile(config) {
  return file(ENGINE_FILE_REL, JSON.stringify(config, null, 2));
}

function pack(engine) {
  return file(`.cadet/agent/core/engines/${engine}/README.md`, `# ${engine} pack\n`);
}

const unityConfig = {
  schemaVersion: 1,
  engine: 'unity',
  unity: { pluginRoot: 'Assets/Covyne/Cadet', cliRoot: 'Assets/Covyne/Cadet/CLI', editorVersion: '2022.3.62f3' },
  unreal: null,
};

/** One sentence, and the fix inside it. */
function assertOneSentenceWithFix(stop) {
  assert.equal(typeof stop, 'string');
  assert.ok(stop.includes(INIT_COMMAND), `the stop must name the fix: ${stop}`);
  assert.equal((stop.match(/\.(?=\s+[A-Z]|$)/g) || []).length, 1, `the stop must be one sentence: ${stop}`);
}

describe('readEngine — no engine configured', () => {
  it('reports a missing file rather than guessing an engine', () => {
    const status = readEngine(work);
    assert.equal(status.missing, true);
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'absent');
    assert.equal(status.engine, null);
    assert.deepEqual(status.engines, []);
    assertOneSentenceWithFix(status.stop);
    assert.ok(status.stop.includes(ENGINE_FILE_REL), 'the stop must name the file it looked for');
  });

  it('composes no command, and says why', () => {
    const result = commandFor(work, 'test');
    assert.equal(result.command, null, 'no engine means no command, never a guessed one');
    assert.equal(result.blocked, 'absent');
    assert.equal(result.message, readEngine(work).stop);
  });

  it('treats an unreadable file as no configuration', () => {
    file(ENGINE_FILE_REL, '{ not json');
    const status = readEngine(work);
    assert.equal(status.missing, true);
    assert.equal(status.reason, 'unreadable');
    assertOneSentenceWithFix(status.stop);
  });

  it('treats a file that names an engine it does not configure as inconsistent', () => {
    writeEngineFile({ schemaVersion: 1, engine: 'unreal', unity: unityConfig.unity, unreal: null });
    const status = readEngine(work);
    assert.equal(status.missing, true);
    assert.equal(status.reason, 'inconsistent');
    assertOneSentenceWithFix(status.stop);
  });
});

describe('readEngine — engine configured', () => {
  it('stops when the pack is not installed, naming the pack', () => {
    writeEngineFile(unityConfig);
    const status = readEngine(work);
    assert.equal(status.configured, true);
    assert.equal(status.engine, 'unity');
    assert.equal(status.reason, 'pack-missing');
    assertOneSentenceWithFix(status.stop);
    assert.ok(status.stop.includes('.cadet/agent/core/engines/unity/README.md'));
    assert.equal(status.packs[0].installed, false);
  });

  it('reports a whole seam when the pack is present', () => {
    writeEngineFile(unityConfig);
    pack('unity');
    const status = readEngine(work);
    assert.equal(status.stop, null);
    assert.equal(status.reason, null);
    assert.equal(status.pack, '.cadet/agent/core/engines/unity/README.md');
    assert.deepEqual(status.packs, [{
      engine: 'unity',
      path: '.cadet/agent/core/engines/unity/README.md',
      installed: true,
    }]);
  });

  it('names both engines when a project installs both, primary first', () => {
    writeEngineFile({
      schemaVersion: 1,
      engine: 'unreal',
      unity: unityConfig.unity,
      unreal: { pluginRoot: 'Plugins/CadetBuild', cliRoot: 'Plugins/CadetBuild/CLI', editorVersion: '5.8' },
    });
    pack('unity');
    pack('unreal');
    const status = readEngine(work);
    assert.deepEqual(status.engines, ['unity', 'unreal']);
    assert.equal(status.engine, 'unreal');
    assert.equal(status.pack, '.cadet/agent/core/engines/unreal/README.md');
  });
});

describe('commandFor — the pack owns the command', () => {
  it('points at the pack and never returns a command string', () => {
    writeEngineFile(unityConfig);
    pack('unity');
    const result = commandFor(work, 'build');
    assert.equal(result.command, null);
    assert.equal(result.blocked, 'pack');
    assert.equal(result.pack, '.cadet/agent/core/engines/unity/README.md');
    assert.ok(result.message.includes(result.pack), 'the message must name where the command lives');
  });

  it('rejects a capability no pack promises', () => {
    assert.throws(() => commandFor(work, 'deploy'), /unknown engine capability/);
  });

  it('covers the four capabilities a pack must answer for', () => {
    assert.deepEqual([...CAPABILITIES], ['build', 'test', 'verify', 'run']);
  });
});

describe('writeEngine', () => {
  it('writes the documented shape and reads back whole', () => {
    file('ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.62f3\nm_EditorVersionWithRevision: 2022.3.62f3 (abc)\n');
    pack('unity');
    const result = writeEngine(work, { engines: ['unity'] });
    assert.equal(result.written, true);

    const config = JSON.parse(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8'));
    assert.deepEqual(config, unityConfig);
    assert.equal(readEngine(work).stop, null);
  });

  it('holds no absolute path, so a second machine can use the file', () => {
    writeEngine(work, { engines: ['unity'] });
    const config = JSON.parse(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8'));
    assert.equal(config.unity.pluginRoot, 'Assets/Covyne/Cadet');
    assert.equal(config.unity.cliRoot, 'Assets/Covyne/Cadet/CLI');
    assert.ok(!JSON.stringify(config).includes(work.replace(/\\/g, '/')), 'the file must be portable');
  });

  it('reads the editor version from the project, and writes null when the project does not say', () => {
    file('MyGame.uproject', JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8' }));
    writeEngine(work, { engines: ['unreal'] });
    const config = JSON.parse(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8'));
    assert.equal(config.unreal.editorVersion, '5.8');
    assert.equal(config.engine, 'unreal');

    const bare = mkdtempSync(join(tmpdir(), 'cadet-engine-bare-'));
    try {
      writeEngine(bare, { engines: ['unity'] });
      const other = JSON.parse(readFileSync(join(bare, ENGINE_FILE_REL), 'utf-8'));
      assert.equal(other.unity.editorVersion, null);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('records both engines, in pack order, when both are chosen', () => {
    writeEngine(work, { engines: ['unreal', 'unity'] });
    const config = JSON.parse(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8'));
    assert.equal(config.engine, 'unreal');
    assert.ok(config.unity && config.unreal);
  });

  it('writes nothing for a project with no engine, and leaves an existing file alone', () => {
    const result = writeEngine(work, { engines: [] });
    assert.equal(result.written, false);
    assert.equal(existsSync(join(work, ENGINE_FILE_REL)), false);

    writeEngineFile(unityConfig);
    const kept = writeEngine(work, { engines: [] });
    assert.equal(kept.written, false);
    assert.deepEqual(JSON.parse(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8')), unityConfig);
  });

  it('is idempotent: a second run writes the same bytes', () => {
    writeEngine(work, { engines: ['unity'] });
    const first = readFileSync(join(work, ENGINE_FILE_REL), 'utf-8');
    writeEngine(work, { engines: ['unity'] });
    assert.equal(readFileSync(join(work, ENGINE_FILE_REL), 'utf-8'), first);
  });
});

describe('resolveEngines — precedence', () => {
  it('prefers the answer, then detection, then the components', () => {
    assert.deepEqual(
      resolveEngines({ answered: ['unreal'], detected: ['unity'], components: ['engine.unity.plugin'] }),
      ['unreal'],
      'the user answered, so the answer wins',
    );
    assert.deepEqual(
      resolveEngines({ detected: ['unity'], components: ['engine.unreal.plugin'] }),
      ['unity'],
      'with no answer, detection wins',
    );
    assert.deepEqual(
      resolveEngines({ components: ['core', 'engine.unreal.plugin'] }),
      ['unreal'],
      'with neither, the installed components prove the engine',
    );
  });

  it('drops names no pack can serve', () => {
    assert.deepEqual(resolveEngines({ answered: ['godot'], detected: ['unity'] }), ['unity']);
    assert.deepEqual(resolveEngines({}), []);
  });
});
