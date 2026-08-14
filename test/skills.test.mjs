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
});
