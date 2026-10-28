import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const coreDir = join(repoRoot, '.cadet', 'agent', 'core');
const enginesDir = join(coreDir, 'engines');

const PACKS = ['unity', 'unreal'];
const CAPABILITIES = ['build', 'test', 'verify', 'run'];

// The file map plan 06 §2.1 defines. A page that is expected and absent is a
// capability with no command behind it, which the README would still name.
const PAGES = {
  unity: ['README.md', 'cli.md', 'coding.md', 'testing.md', 'verification.md', 'mcp.md', 'patterns.md'],
  unreal: ['README.md', 'coding.md', 'blueprints.md', 'mcp.md', 'optimization.md', 'planning.md', 'review.md', 'breakdown.md'],
};

// The five tokens plan 06 defines once, so a pack cannot invent its own spelling.
const TOKENS = ['projectRoot', 'uproject', 'gameModule', 'buildScript', 'testCommand'];

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf-8');
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('Engine packs', () => {
  it('has a pack for each engine the framework supports', () => {
    for (const engine of PACKS) {
      assert.equal(existsSync(join(enginesDir, engine, 'README.md')), true, `${engine} pack has no README`);
    }
  });

  for (const engine of PACKS) {
    describe(`${engine} pack`, () => {
      const readmePath = join(enginesDir, engine, 'README.md');
      const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : '';

      it('names every capability a phase skill delegates', () => {
        for (const capability of CAPABILITIES) {
          assert.match(
            readme,
            new RegExp(`\\b${capability}\\b`, 'i'),
            `the ${engine} pack README must name the ${capability} capability`,
          );
        }
      });

      it('names a command, not only the capability', () => {
        // A capability word with no command behind it is the hollow page this epic exists to avoid.
        const fences = readme.split(/```/).filter((_, i) => i % 2 === 1);
        const inline = [...readme.matchAll(/`[^`\n]+`/g)].map((m) => m[0]);
        assert.ok(
          fences.length > 0 || inline.length >= CAPABILITIES.length,
          `the ${engine} pack must carry the commands, in code spans or fences`,
        );
      });

      it('ships the pages the plan defines', () => {
        const dir = join(enginesDir, engine);
        const absent = PAGES[engine].filter((page) => !existsSync(join(dir, page)));
        assert.deepEqual(absent, [], `${engine} pack is missing: ${absent.join(', ')}`);
      });

      it('links every page it ships', () => {
        // A page nothing points at is a page no agent reads. This is the discovery
        // guard for the pack: add a file without a link and the suite says so.
        const pages = readdirSync(join(enginesDir, engine))
          .filter((f) => f.endsWith('.md') && f !== 'README.md');
        const missing = pages.filter((page) => !readme.includes(`(${page})`));
        assert.deepEqual(missing, [], `unlinked page(s) in the ${engine} pack: ${missing.join(', ')}`);
      });
    });
  }

  it('uses no token outside the five the plan defines', () => {
    const used = new Set();
    for (const engine of PACKS) {
      const dir = join(enginesDir, engine);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        const text = readFileSync(join(dir, file), 'utf-8');
        for (const match of text.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)) used.add(match[1]);
      }
    }
    const unknown = [...used].filter((token) => !TOKENS.includes(token));
    assert.deepEqual(unknown, [], `token(s) no pack defines: ${unknown.join(', ')}`);
  });
});

describe('The pack names no project of its own', () => {
  // The migration's own acceptance: the framework content a consumer installs must
  // not carry the game it was generalised from. `.cadet/agent/core/` is that content;
  // `packages/*/PROVENANCE.md` names the source repository on purpose (decision D9),
  // so the guard is scoped to core rather than to the whole tree.
  const coreFiles = walk(coreDir).filter((f) => /\.(md|json)$/.test(f));

  it('ships no name of the source game', () => {
    const hits = coreFiles.filter((f) => /bloodstone/i.test(readFileSync(f, 'utf-8')));
    assert.deepEqual(hits.map((f) => f.replace(repoRoot, '').replace(/\\/g, '/')), [],
      'a core file names the game the Unreal pack was generalised from');
  });

  it('ships no tool name from an extension the framework does not carry', () => {
    // chat-cost-sync, classify-chat and extract-automation stay in the source project
    // by decision D12; their tool names must not arrive with the pack.
    const forbidden = ['procedure_apply', 'find_relevant_symbols', 'optimize_context'];
    const hits = [];
    for (const file of coreFiles) {
      const text = readFileSync(file, 'utf-8');
      for (const name of forbidden) {
        if (text.includes(name)) hits.push(`${file.replace(repoRoot, '')}: ${name}`);
      }
    }
    assert.deepEqual(hits, [], `brainstem tool name(s) reached core:\n  ${hits.join('\n  ')}`);
  });
});

describe('The Unity pack carries what the de-Unity pass removed from core', () => {
  // E3a deleted these conventions from the engine-neutral files and owed them to the
  // pack (plan 06 §4a). This is the check that the debt was paid: a convention that
  // left core and reached neither the directive nor the pack was deleted, not moved.
  const pack = () => {
    const dir = join(enginesDir, 'unity');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => readFileSync(join(dir, f), 'utf-8'))
      .join('\n');
  };

  const owed = [
    ['the recompile focus rule', /focus/i],
    ['prefab-based slices', /prefab/i],
    ['multiple scenes for merge pressure', /scenes/i],
    ['lifecycle callbacks for handlers', /OnEnable/],
    ['glyph coverage and font regeneration', /glyph/i],
    ['the analyzer rule family', /UNT/],
    ['the CLI bootstrap commands', /unity install/],
    ['locale key ordering', /locale/i],
  ];

  for (const [name, pattern] of owed) {
    it(`carries ${name}`, () => {
      assert.match(pack(), pattern, `the Unity pack never restored ${name}`);
    });
  }
});
