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
  'Handoff.md',
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
  'cadet-handoff.prompt.md',
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

describe('Repository-role boundary in skills', () => {
  // Every phase skill must tell the agent what to do when there is no active
  // state, so it cannot reason about stories/gates in the framework source repo.
  const allSkills = [...expectedSkills, 'AgentReviewer.md', 'PlanningReview.md'];

  for (const skill of allSkills) {
    it(`${skill} documents the no-active-state branch`, () => {
      const content = readFileSync(join(skillsDir, skill), 'utf-8');
      assert.ok(
        content.includes('.cadet/agent/project-plans/'),
        `${skill} must name .cadet/agent/project-plans/ in its no-active-state branch`,
      );
      assert.ok(
        content.includes('CONTRIBUTING.md'),
        `${skill} must point framework-source users at CONTRIBUTING.md`,
      );
    });
  }

  it('KickoffFlow detects the repository role before the consumer flow', () => {
    const content = readFileSync(join(coreDir, 'KickoffFlow.md'), 'utf-8');
    assert.ok(content.includes('.cadet/agent/project-plans/'), 'KickoffFlow must check for project-plans');
    assert.ok(content.includes('CONTRIBUTING.md'), 'KickoffFlow must point framework-source users at CONTRIBUTING.md');
  });
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

  it('accepts v1, v2 and v3 state documents', () => {
    const schema = JSON.parse(readFileSync(join(coreDir, 'state.schema.json'), 'utf-8'));
    // Enum updated in lockstep with the contract v3 bump. v1 and v2 remain
    // readable: the bump must not invalidate existing documents.
    assert.deepEqual(schema.properties.version.enum, [1, 2, 3]);
    for (const field of ['stateVersion', 'gateEvidence', 'activeRunId', 'activeWorkItem', 'lastTransition']) {
      assert.ok(schema.properties[field], `v2/v3 schema must define ${field}`);
    }
  });

  it('declares the v3 strict-closure policy and evidence fields', () => {
    const stateSchema = JSON.parse(readFileSync(join(coreDir, 'state.schema.json'), 'utf-8'));
    const harnessSchema = JSON.parse(readFileSync(join(coreDir, 'harness.schema.json'), 'utf-8'));
    // The policy knob must exist in the schema, or a user could not enable it.
    const strict = harnessSchema.$defs.policy.properties.strictClosure;
    assert.ok(strict, 'harness.schema.json must define policy.strictClosure');
    assert.equal(strict.properties.enabled.default, false, 'strictClosure must default to off (opt-in)');
    assert.deepEqual(strict.properties.disallowManualFor.default, ['testsPassed']);
    // The manual-confirmation quality fields must be expressible.
    for (const field of ['reason', 'environment', 'scope']) {
      assert.ok(harnessSchema.$defs.evidence.properties[field], `evidence schema must define ${field}`);
    }
    // The exception taxonomy must be expressible on a gate-exception entry.
    const changeEntry = stateSchema.properties.changeHistory.items.properties;
    assert.ok(changeEntry.category, 'changeHistory entry must define category');
    assert.ok(changeEntry.closureReviewNote, 'changeHistory entry must define closureReviewNote');
    assert.deepEqual(changeEntry.category.enum, [
      'manual-compile', 'budget-override', 'analyzer-fallback',
      'unscoped-freshness', 'documentation-only', 'tooling-gap',
    ]);
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

  it('Handoff separates verified from claimed and records the next action', () => {
    const content = readFileSync(join(skillsDir, 'Handoff.md'), 'utf-8');
    assert.ok(/verified/i.test(content), 'Handoff must separate verified work from claimed work');
    assert.ok(/unverified|claimed/i.test(content), 'Handoff must name the unverified/claimed category');
    assert.ok(/next step/i.test(content), 'Handoff must record next steps');
    assert.ok(/uncommitted/i.test(content), 'Handoff must report uncommitted work');
    assert.ok(/harness report/i.test(content), 'Handoff must load the run report');
  });

  it('Handoff writes a durable artifact and never advances state', () => {
    const content = readFileSync(join(skillsDir, 'Handoff.md'), 'utf-8');
    assert.ok(content.includes('.cadet/handoffs/'), 'Handoff must write to .cadet/handoffs/');
    assert.ok(/dry-run/.test(content), 'Handoff must use --dry-run when inspecting the next transition');
    assert.ok(
      /never (transition|advance)/i.test(content),
      'Handoff must state that it never advances the phase',
    );
  });

  it('Handoff names records chronologically so the latest is discoverable', () => {
    const content = readFileSync(join(skillsDir, 'Handoff.md'), 'utf-8');
    // Matches the template including its angle-bracket placeholders and the
    // separators between them, e.g. `<YYYY-MM-DD-HHmm>-<description>.md`.
    const template = content.match(/\.cadet\/handoffs\/<[^/`\s]+\.md/);
    assert.ok(template, 'Handoff must state a concrete handoff filename template');
    const shape = template[0];

    // Date before time is what makes a plain `ls` chronological. Time-first
    // names sort wrongly across days: `23:59-2026-09-15` sorts after
    // `00:01-2026-09-16`.
    assert.ok(shape.includes('YYYY-MM-DD'), `handoff name must lead with the date: ${shape}`);
    assert.ok(shape.includes('HHmm'), `handoff name must include a zero-padded time: ${shape}`);
    assert.ok(
      shape.indexOf('YYYY-MM-DD') < shape.indexOf('HHmm'),
      `handoff name must put the date before the time: ${shape}`,
    );

    // A colon is illegal on Windows, so it must never appear in the template.
    assert.ok(!shape.includes(':'), `handoff filename must not contain a colon: ${shape}`);

    // The name must carry a description, otherwise the directory is unreadable.
    assert.ok(/description/.test(shape), `handoff name must include a description slug: ${shape}`);
  });
});
