import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const coreDir = join(repoRoot, '.cadet', 'agent', 'core');
const skillsDir = join(coreDir, 'skills');
const promptsDir = join(repoRoot, '.github', 'prompts');
const manifestPath = join(coreDir, 'FrameworkManifest.json');
const directivePath = join(coreDir, 'cadet-agent.md');

const expectedSkills = [
  'Requirements.md',
  'Architecture.md',
  'Spike.md',
  'StoryBreakdown.md',
  'TDD.md',
  'Debugging.md',
  'CodeReview.md',
  'Resume.md',
  'MCPSetup.md',
];

const expectedPrompts = [
  'cadet-requirements.prompt.md',
  'cadet-architecture.prompt.md',
  'cadet-spike.prompt.md',
  'cadet-breakdown.prompt.md',
  'cadet-tdd.prompt.md',
  'cadet-debug.prompt.md',
  'cadet-review.prompt.md',
  'cadet-resume.prompt.md',
  'cadet-mcp-setup.prompt.md',
];

describe('Skill files', () => {
  it('has a skills directory under .cadet/agent/core', () => {
    assert.equal(existsSync(skillsDir), true);
  });

  it('includes the canonical reviewer skill', () => {
    const path = join(skillsDir, 'AgentReviewer.md');
    assert.equal(existsSync(path), true, 'missing AgentReviewer.md');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('<role>'), 'AgentReviewer.md must include a role block');
    assert.ok(content.includes('.cadet/agent/core/cadet-agent.md'), 'AgentReviewer.md must reference cadet-agent.md');
  });

  for (const skill of expectedSkills) {
    it(`includes core skill ${skill}`, () => {
      const path = join(skillsDir, skill);
      assert.equal(existsSync(path), true, `missing ${path}`);
      const content = readFileSync(path, 'utf-8');
      assert.ok(content.includes('Gate Check'), `${skill} must open with a gate check`);
      assert.ok(content.includes('.cadet/state.json'), `${skill} must reference state.json`);
    });
  }
});

describe('Copilot prompt adapters', () => {
  it('has a .github/prompts directory', () => {
    assert.equal(existsSync(promptsDir), true);
  });

  for (const prompt of expectedPrompts) {
    it(`includes prompt ${prompt}`, () => {
      const path = join(promptsDir, prompt);
      assert.equal(existsSync(path), true, `missing ${path}`);
      const content = readFileSync(path, 'utf-8');
      assert.ok(content.startsWith('---'), `${prompt} must start with YAML frontmatter`);
      assert.ok(content.includes('description:'), `${prompt} frontmatter must include a description`);
      assert.ok(content.includes('.cadet/agent/core/skills/'), `${prompt} must reference its canonical skill`);
    });
  }
});

describe('FrameworkManifest managed paths', () => {
  it('includes core skills directory', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.managedPaths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.includes('.cadet/agent/core/skills'), 'skills dir must be managed');
  });

  it('includes every Copilot prompt file', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.managedPaths.map(p => p.replace(/\\/g, '/'));
    for (const prompt of expectedPrompts) {
      assert.ok(normalized.includes(`.github/prompts/${prompt}`), `${prompt} must be managed`);
    }
  });
});

describe('Thin directive', () => {
  it('references skill dispatch and core skills', () => {
    const directive = readFileSync(directivePath, 'utf-8');
    assert.ok(directive.includes('## Skill Dispatch'), 'directive must have a Skill Dispatch section');
    assert.ok(directive.includes('.cadet/agent/core/skills/'), 'directive must reference core skills');
    assert.ok(directive.includes('/cadet-review'), 'directive must reference /cadet-review');
  });

  it('no longer embeds detailed skill instruction sections', () => {
    const directive = readFileSync(directivePath, 'utf-8');
    assert.equal(directive.includes('### Requirements (dispatched for large changes)'), false, 'Requirements details should be in skill file');
    assert.equal(directive.includes('### CodeReview (dispatched after each story completion'), false, 'CodeReview details should be in skill file');
  });
});

describe('state.schema.json', () => {
  it('exists under .cadet/agent/core', () => {
    assert.equal(existsSync(join(coreDir, 'state.schema.json')), true);
  });

  it('is listed as a managed path', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.managedPaths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.includes('.cadet/agent/core/state.schema.json'), 'state.schema.json must be managed');
  });

  it('lists .cadet/state.json as a preserved path', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.preservedPaths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.includes('.cadet/state.json'), 'state.json must be preserved');
  });

  it('is valid JSON and describes expected gates', () => {
    const schema = JSON.parse(readFileSync(join(coreDir, 'state.schema.json'), 'utf-8'));
    const gateNames = Object.keys(schema.properties.gates.properties);
    for (const gate of ['testsPassed', 'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated']) {
      assert.ok(gateNames.includes(gate), `schema must define gate ${gate}`);
    }
  });

  it('accepts both v1 and v2 state documents', () => {
    const schema = JSON.parse(readFileSync(join(coreDir, 'state.schema.json'), 'utf-8'));
    assert.deepEqual(schema.properties.version.enum, [1, 2]);
    for (const field of ['stateVersion', 'gateEvidence', 'activeRunId', 'activeWorkItem', 'lastTransition']) {
      assert.ok(schema.properties[field], `v2 schema must define ${field}`);
    }
  });
});

describe('harness artifacts', () => {
  it('ships Harness.md, harness.schema.json, and harness.json', () => {
    assert.equal(existsSync(join(coreDir, 'Harness.md')), true, 'missing Harness.md');
    assert.equal(existsSync(join(coreDir, 'harness.schema.json')), true, 'missing harness.schema.json');
    assert.equal(existsSync(join(repoRoot, '.cadet', 'harness.json')), true, 'missing .cadet/harness.json');
  });

  it('lists Harness.md and harness.schema.json as managed paths', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.managedPaths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.includes('.cadet/agent/core/Harness.md'), 'Harness.md must be managed');
    assert.ok(normalized.includes('.cadet/agent/core/harness.schema.json'), 'harness.schema.json must be managed');
  });

  it('lists .cadet/harness.json and .cadet/runs as preserved paths', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const normalized = manifest.preservedPaths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.includes('.cadet/harness.json'), 'harness.json must be preserved');
    assert.ok(normalized.includes('.cadet/runs'), 'runs must be preserved');
  });

  it('has a valid harness schema with the required definitions', () => {
    const schema = JSON.parse(readFileSync(join(coreDir, 'harness.schema.json'), 'utf-8'));
    for (const def of ['policy', 'evidence', 'span', 'decision', 'run', 'stateV2']) {
      assert.ok(schema.$defs[def], `harness schema must define $defs.${def}`);
    }
  });
});

// ── Harness contract per skill (Phase 7 exit criterion) ─────────────────────
//
// Every canonical skill must either consume or emit harness records, and must
// reference Harness.md. This fails if a skill omits its required harness contract.

describe('Skill harness contract', () => {
  const harnessSkills = [
    'Requirements.md',
    'Architecture.md',
    'Spike.md',
    'StoryBreakdown.md',
    'TDD.md',
    'Debugging.md',
    'CodeReview.md',
    'Resume.md',
    'MCPSetup.md',
    'AgentReviewer.md',
  ];

  for (const skill of harnessSkills) {
    it(`${skill} references the harness contract`, () => {
      const content = readFileSync(join(skillsDir, skill), 'utf-8');
      assert.ok(
        content.includes('.cadet/agent/core/Harness.md'),
        `${skill} must reference .cadet/agent/core/Harness.md`
      );
    });
  }

  it('TDD requires red/green evidence for testsPassed', () => {
    const content = readFileSync(join(skillsDir, 'TDD.md'), 'utf-8');
    assert.ok(/red/i.test(content), 'TDD must mention the red record');
    assert.ok(content.includes('testsPassed'), 'TDD must reference the testsPassed gate');
    assert.ok(/evidence/i.test(content), 'TDD must require evidence');
  });

  it('CodeReview audits the ledger, evidence freshness, and budget status', () => {
    const content = readFileSync(join(skillsDir, 'CodeReview.md'), 'utf-8');
    assert.ok(/ledger/i.test(content), 'CodeReview must audit the run ledger');
    assert.ok(/fresh/i.test(content), 'CodeReview must check evidence freshness');
    assert.ok(/budget/i.test(content), 'CodeReview must audit budget status');
  });

  it('Debugging requires classification and bounded retries', () => {
    const content = readFileSync(join(skillsDir, 'Debugging.md'), 'utf-8');
    assert.ok(/deterministic/i.test(content), 'Debugging must classify deterministic failures');
    assert.ok(/transient/i.test(content), 'Debugging must classify transient failures');
  });

  it('Resume validates the active run, stale evidence, and legal transition', () => {
    const content = readFileSync(join(skillsDir, 'Resume.md'), 'utf-8');
    assert.ok(/harness report/i.test(content), 'Resume must load the run report');
    assert.ok(/evidence/i.test(content), 'Resume must check evidence freshness');
    assert.ok(/transition/i.test(content), 'Resume must check the next legal transition');
  });

  it('StoryBreakdown requires per-story verification commands', () => {
    const content = readFileSync(join(skillsDir, 'StoryBreakdown.md'), 'utf-8');
    assert.ok(/verification command/i.test(content), 'StoryBreakdown must require verification commands');
    assert.ok(/retry policy/i.test(content), 'StoryBreakdown must require a retry policy');
  });

  it('Spike requires a bounded budget and stop condition', () => {
    const content = readFileSync(join(skillsDir, 'Spike.md'), 'utf-8');
    assert.ok(/stop condition/i.test(content), 'Spike must declare a stop condition');
    assert.ok(/budget/i.test(content), 'Spike must be bounded by budget');
  });

  it('MCPSetup requires round-trip evidence and mutation approval', () => {
    const content = readFileSync(join(skillsDir, 'MCPSetup.md'), 'utf-8');
    assert.ok(/round-trip/i.test(content), 'MCPSetup must require round-trip evidence');
    assert.ok(/confirmation|approval/i.test(content), 'MCPSetup must require mutation approval');
  });

  it('AgentReviewer audits evidence-backed gates and ledger completeness', () => {
    const content = readFileSync(join(skillsDir, 'AgentReviewer.md'), 'utf-8');
    assert.ok(/Harness Audit/i.test(content), 'AgentReviewer must have a harness audit');
    assert.ok(/ledger/i.test(content), 'AgentReviewer must audit the ledger');
  });
});
