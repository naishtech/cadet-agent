import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const coreDir = join(repoRoot, '.cadet', 'agent', 'core');
const skillsDir = join(coreDir, 'skills');
const manifestPath = join(coreDir, 'FrameworkManifest.json');
const directivePath = join(coreDir, 'cadet-agent.md');

// ── Expected canonical skills ───────────────────────────────────────────────

const expectedSkills = [
  'Requirements.md',
  'Architecture.md',
  'Spike.md',
  'StoryBreakdown.md',
  'TDD.md',
  'Debugging.md',
  'CodeReview.md',
  'Resume.md',
];

// ── Per-IDE expected adapter files ──────────────────────────────────────────

const ideAdapters = {
  'github-copilot': {
    baseDir: join(repoRoot, '.github'),
    agentFile: '.github/agents/cadet.agent.md',
    reviewerFile: '.github/agents/cadet-agent-reviewer.agent.md',
    promptsDir: '.github/prompts',
    promptPrefix: 'cadet-',
    promptSuffix: '.prompt.md',
    skillToPrompt: {
      'Requirements.md': 'cadet-requirements.prompt.md',
      'Architecture.md': 'cadet-architecture.prompt.md',
      'Spike.md': 'cadet-spike.prompt.md',
      'StoryBreakdown.md': 'cadet-breakdown.prompt.md',
      'TDD.md': 'cadet-tdd.prompt.md',
      'Debugging.md': 'cadet-debug.prompt.md',
      'CodeReview.md': 'cadet-review.prompt.md',
    },
    extraPrompts: ['cadet-resume.prompt.md'],
  },
  cursor: {
    baseDir: join(repoRoot, '.cursor'),
    rulesDir: '.cursor/rules',
    ruleFile: '.cursor/rules/cadet-agent.md',
    reviewerFile: '.cursor/rules/cadet-agent-reviewer.md',
  },
  continue: {
    baseDir: join(repoRoot, '.continue'),
    rulesDir: '.continue/rules',
    ruleFile: '.continue/rules/cadet-agent.md',
    reviewerFile: '.continue/rules/cadet-agent-reviewer.md',
    configFile: '.continue/config.yaml',
  },
  'claude-code': {
    baseDir: join(repoRoot, '.claude'),
    skillsDir: join(repoRoot, '.claude', 'skills'),
    skillFile: '.claude/skills/cadet-agent/SKILL.md',
    reviewerFile: '.claude/skills/cadet-agent-reviewer/SKILL.md',
    skillToFile: {
      'Requirements.md': 'cadet-requirements/SKILL.md',
      'Architecture.md': 'cadet-architecture/SKILL.md',
      'Spike.md': 'cadet-spike/SKILL.md',
      'StoryBreakdown.md': 'cadet-breakdown/SKILL.md',
      'TDD.md': 'cadet-tdd/SKILL.md',
      'Debugging.md': 'cadet-debug/SKILL.md',
      'CodeReview.md': 'cadet-review/SKILL.md',
    },
    extraSkills: ['cadet-resume/SKILL.md'],
  },
};

// ── Helper ──────────────────────────────────────────────────────────────────

function resolvePath(relativePath) {
  if (isAbsolute(relativePath)) return relativePath;
  return join(repoRoot, relativePath.replace(/\//g, '/'));
}

function fileExists(relativePath) {
  return existsSync(resolvePath(relativePath));
}

function readFile(relativePath) {
  return readFileSync(resolvePath(relativePath), 'utf-8');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Adapter inventory', () => {
  // ── Core skills exist ──────────────────────────────────────────────────

  it('has all expected core skills', () => {
    for (const skill of expectedSkills) {
      const path = join(skillsDir, skill);
      assert.ok(existsSync(path), `missing core skill: ${skill}`);
    }
  });

  // ── GitHub Copilot adapters ────────────────────────────────────────────

  describe('GitHub Copilot', () => {
    const copilot = ideAdapters['github-copilot'];

    it('has agent definition', () => {
      assert.ok(fileExists(copilot.agentFile), 'missing cadet.agent.md');
    });

    it('has reviewer agent definition', () => {
      assert.ok(fileExists(copilot.reviewerFile), 'missing cadet-agent-reviewer.agent.md');
    });

    it('agent references cadet-agent.md', () => {
      const content = readFile(copilot.agentFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'agent must reference cadet-agent.md'
      );
    });

    it('reviewer references cadet-agent.md', () => {
      const content = readFile(copilot.reviewerFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'reviewer must reference cadet-agent.md'
      );
    });

    for (const [skill, promptFile] of Object.entries(copilot.skillToPrompt)) {
      it(`has prompt for ${skill}`, () => {
        const path = join(copilot.promptsDir, promptFile);
        assert.ok(fileExists(path), `missing prompt: ${path}`);
      });

      it(`prompt ${promptFile} references its canonical skill`, () => {
        const content = readFile(join(copilot.promptsDir, promptFile));
        assert.ok(
          content.includes(`.cadet/agent/core/skills/${skill}`),
          `${promptFile} must reference .cadet/agent/core/skills/${skill}`
        );
      });

      it(`prompt ${promptFile} has frontmatter`, () => {
        const content = readFile(join(copilot.promptsDir, promptFile));
        assert.ok(content.startsWith('---'), `${promptFile} must start with YAML frontmatter`);
      });

      it(`prompt ${promptFile} has Gate Check`, () => {
        const content = readFile(join(copilot.promptsDir, promptFile));
        assert.ok(content.includes('Gate Check'), `${promptFile} must include a gate check`);
      });
    }

    for (const extra of copilot.extraPrompts) {
      it(`has extra prompt ${extra}`, () => {
        const path = join(copilot.promptsDir, extra);
        assert.ok(fileExists(path), `missing extra prompt: ${path}`);
      });
    }
  });

  // ── Cursor adapters ────────────────────────────────────────────────────

  describe('Cursor', () => {
    const cursor = ideAdapters['cursor'];

    it('has rule file', () => {
      assert.ok(fileExists(cursor.ruleFile), 'missing cadet-agent.md rule');
    });

    it('rule references cadet-agent.md', () => {
      const content = readFile(cursor.ruleFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Cursor rule must reference cadet-agent.md'
      );
    });

    it('rule references state.json', () => {
      const content = readFile(cursor.ruleFile);
      assert.ok(
        content.includes('.cadet/state.json') || content.includes('state.json'),
        'Cursor rule must reference state.json'
      );
    });

    it('rule references skills directory for dispatch', () => {
      const content = readFile(cursor.ruleFile);
      assert.ok(
        content.includes('.cadet/agent/core/skills/'),
        'Cursor rule must reference core skills directory for dispatch'
      );
    });

    it('has reviewer rule', () => {
      assert.ok(fileExists(cursor.reviewerFile), 'missing cadet-agent-reviewer.md rule');
    });

    it('reviewer references cadet-agent.md', () => {
      const content = readFile(cursor.reviewerFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Cursor reviewer must reference cadet-agent.md'
      );
    });

    it('rule has YAML frontmatter with alwaysApply', () => {
      const content = readFile(cursor.ruleFile);
      assert.ok(content.startsWith('---'), 'Cursor rule must start with YAML frontmatter');
      assert.ok(content.includes('alwaysApply'), 'Cursor rule frontmatter must include alwaysApply');
    });

    it('rule does not duplicate skill process content', () => {
      const content = readFile(cursor.ruleFile);
      // These are process-heavy strings from skill files that should not appear in adapters
      const forbidden = [
        'Given/When/Then acceptance criteria',
        'red/green test-first',
        'ADRDecisionTemplate',
      ];
      for (const phrase of forbidden) {
        assert.ok(
          !content.includes(phrase),
          `Cursor rule must not contain: "${phrase}" (should be in canonical skill file)`
        );
      }
    });
  });

  // ── Continue adapters ──────────────────────────────────────────────────

  describe('Continue', () => {
    const cont = ideAdapters['continue'];

    it('has rule file', () => {
      assert.ok(fileExists(cont.ruleFile), 'missing cadet-agent.md rule');
    });

    it('rule references cadet-agent.md', () => {
      const content = readFile(cont.ruleFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Continue rule must reference cadet-agent.md'
      );
    });

    it('rule references state.json', () => {
      const content = readFile(cont.ruleFile);
      assert.ok(
        content.includes('.cadet/state.json') || content.includes('state.json'),
        'Continue rule must reference state.json'
      );
    });

    it('rule references skills directory for dispatch', () => {
      const content = readFile(cont.ruleFile);
      assert.ok(
        content.includes('.cadet/agent/core/skills/'),
        'Continue rule must reference core skills directory for dispatch'
      );
    });

    it('has reviewer rule', () => {
      assert.ok(fileExists(cont.reviewerFile), 'missing cadet-agent-reviewer.md rule');
    });

    it('reviewer references cadet-agent.md', () => {
      const content = readFile(cont.reviewerFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Continue reviewer must reference cadet-agent.md'
      );
    });

    it('rule has YAML frontmatter', () => {
      const content = readFile(cont.ruleFile);
      assert.ok(content.startsWith('---'), 'Continue rule must start with YAML frontmatter');
      assert.ok(content.includes('name:'), 'Continue rule frontmatter must include name');
      assert.ok(content.includes('description:'), 'Continue rule frontmatter must include description');
    });

    it('reviewer rule has YAML frontmatter', () => {
      const content = readFile(cont.reviewerFile);
      assert.ok(content.startsWith('---'), 'Continue reviewer rule must start with YAML frontmatter');
    });

    it('has config.yaml', () => {
      assert.ok(fileExists(cont.configFile), 'missing config.yaml');
    });

    it('config.yaml defines custom commands for each skill', () => {
      const content = readFile(cont.configFile);
      const skillNames = [
        'cadet-requirements', 'cadet-architecture', 'cadet-spike',
        'cadet-breakdown', 'cadet-tdd', 'cadet-debug', 'cadet-review',
        'cadet-resume', 'cadet-agent-reviewer',
      ];
      for (const name of skillNames) {
        assert.ok(
          content.includes(`name: ${name}`),
          `config.yaml must define custom command: ${name}`
        );
      }
    });

    it('config.yaml custom commands reference canonical skill files', () => {
      const content = readFile(cont.configFile);
      assert.ok(
        content.includes('.cadet/agent/core/skills/'),
        'config.yaml commands must reference canonical skill files'
      );
    });
  });

  // ── Claude Code adapters ───────────────────────────────────────────────

  describe('Claude Code', () => {
    const claude = ideAdapters['claude-code'];

    it('has base skill file', () => {
      assert.ok(fileExists(claude.skillFile), 'missing cadet-agent.md skill');
    });

    it('base skill references cadet-agent.md', () => {
      const content = readFile(claude.skillFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Claude base skill must reference cadet-agent.md'
      );
    });

    it('base skill references state.json', () => {
      const content = readFile(claude.skillFile);
      assert.ok(
        content.includes('.cadet/state.json') || content.includes('state.json'),
        'Claude base skill must reference state.json'
      );
    });

    it('base skill has YAML frontmatter with name', () => {
      const content = readFile(claude.skillFile);
      assert.ok(content.startsWith('---'), 'Claude base skill must start with YAML frontmatter');
      assert.ok(content.includes('name:'), 'Claude base skill frontmatter must include name');
    });

    for (const [skill, skillFile] of Object.entries(claude.skillToFile)) {
      const fullPath = join(claude.skillsDir, skillFile);

      it(`has per-phase skill for ${skill}`, () => {
        assert.ok(fileExists(fullPath), `missing Claude skill: ${fullPath}`);
      });

      it(`skill ${skillFile} references its canonical source`, () => {
        const content = readFile(fullPath);
        assert.ok(
          content.includes(`.cadet/agent/core/skills/${skill}`),
          `${skillFile} must reference .cadet/agent/core/skills/${skill}`
        );
      });

      it(`skill ${skillFile} has YAML frontmatter with name`, () => {
        const content = readFile(fullPath);
        assert.ok(content.startsWith('---'), `${skillFile} must start with YAML frontmatter`);
        assert.ok(content.includes('name:'), `${skillFile} frontmatter must include name`);
        assert.ok(content.includes('description:'), `${skillFile} frontmatter must include description`);
      });

      it(`skill ${skillFile} has Gate Check`, () => {
        const content = readFile(fullPath);
        assert.ok(content.includes('Gate Check'), `${skillFile} must include a gate check`);
      });
    }

    for (const extra of claude.extraSkills) {
      it(`has extra skill ${extra}`, () => {
        const path = join(claude.skillsDir, extra);
        assert.ok(fileExists(path), `missing extra Claude skill: ${path}`);
      });
    }

    it('has reviewer skill', () => {
      assert.ok(fileExists(claude.reviewerFile), 'missing cadet-agent-reviewer.md skill');
    });

    it('reviewer references cadet-agent.md', () => {
      const content = readFile(claude.reviewerFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Claude reviewer must reference cadet-agent.md'
      );
    });
  });

  // ── FrameworkManifest coverage ─────────────────────────────────────────

  describe('FrameworkManifest managed paths', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const managed = manifest.managedPaths.map(p => p.replace(/\\/g, '/'));

    // Collect all expected managed paths from the adapter inventory
    const allExpected = [
      // GitHub Copilot
      '.github/agents/cadet.agent.md',
      '.github/agents/cadet-agent-reviewer.agent.md',
      '.github/hooks/git-guard.json',
      '.github/hooks/scripts/git-guard.sh',
      '.github/hooks/scripts/git-guard.ps1',
      '.github/prompts/cadet-requirements.prompt.md',
      '.github/prompts/cadet-architecture.prompt.md',
      '.github/prompts/cadet-spike.prompt.md',
      '.github/prompts/cadet-breakdown.prompt.md',
      '.github/prompts/cadet-tdd.prompt.md',
      '.github/prompts/cadet-debug.prompt.md',
      '.github/prompts/cadet-review.prompt.md',
      '.github/prompts/cadet-resume.prompt.md',
      // Cursor
      '.cursor/rules/cadet-agent.md',
      '.cursor/rules/cadet-agent-reviewer.md',
      // Continue
      '.continue/rules/cadet-agent.md',
      '.continue/rules/cadet-agent-reviewer.md',
      '.continue/config.yaml',
      // Claude Code
      '.claude/skills/cadet-agent',
      '.claude/skills/cadet-agent-reviewer',
      '.claude/skills/cadet-requirements',
      '.claude/skills/cadet-architecture',
      '.claude/skills/cadet-spike',
      '.claude/skills/cadet-breakdown',
      '.claude/skills/cadet-tdd',
      '.claude/skills/cadet-debug',
      '.claude/skills/cadet-review',
      '.claude/skills/cadet-resume',
      // Core
      '.cadet/agent/core',
      '.cadet/agent/core/templates',
      '.cadet/agent/core/skills',
      '.cadet/agent/core/state.schema.json',
    ];

    for (const expected of allExpected) {
      it(`includes ${expected} in managedPaths`, () => {
        assert.ok(
          managed.includes(expected),
          `FrameworkManifest.json missing managed path: ${expected}`
        );
      });
    }

    it('preserves user paths', () => {
      const preserved = manifest.preservedPaths.map(p => p.replace(/\\/g, '/'));
      assert.ok(preserved.includes('.cadet/agent/policies'), 'policies must be preserved');
      assert.ok(preserved.includes('.cadet/agent/project-plans'), 'project-plans must be preserved');
      assert.ok(preserved.includes('.cadet/state.json'), 'state.json must be preserved');
    });
  });

  // ── No adapter duplicates canonical content ────────────────────────────

  describe('No adapter duplicates canonical content', () => {
    // Read canonical skill content for comparison
    function getSkillFingerprints() {
      const fingerprints = new Set();
      for (const skill of expectedSkills) {
        const content = readFileSync(join(skillsDir, skill), 'utf-8');
        // Extract key unique phrases that identify process content
        const lines = content.split('\n');
        // Collect headings that are unique to each skill
        for (const line of lines) {
          const trimmed = line.trim();
          if (/^#{1,4}\s/.test(trimmed)) {
            fingerprints.add(trimmed);
          }
        }
      }
      return fingerprints;
    }

    const skillHeadings = getSkillFingerprints();

    function checkNoDuplication(filePath, label) {
      if (!existsSync(resolvePath(filePath))) return;
      const content = readFile(filePath);
      const violations = [];
      for (const heading of skillHeadings) {
        // Only flag process headings (not generic ones like "Purpose" or "Process")
        if (
          heading.includes('Red/Green') ||
          heading.includes('Acceptance Criteria') ||
          heading.includes('Technology Decision') ||
          heading.includes('Persistent-Failure') ||
          heading.includes('Spike Template') ||
          heading.includes('Epic Template') ||
          heading.includes('Story Template')
        ) {
          if (content.includes(heading)) {
            violations.push(heading);
          }
        }
      }
      if (violations.length > 0) {
        assert.fail(
          `${label} duplicates canonical skill content: ${violations.join(', ')}`
        );
      }
    }

    it('Cursor rule does not duplicate skill content', () => {
      checkNoDuplication('.cursor/rules/cadet-agent.md', 'Cursor rule');
    });

    it('Continue rule does not duplicate skill content', () => {
      checkNoDuplication('.continue/rules/cadet-agent.md', 'Continue rule');
    });

    it('Claude Code base skill does not duplicate skill content', () => {
      checkNoDuplication('.claude/skills/cadet-agent/SKILL.md', 'Claude base skill');
    });
  });
});
