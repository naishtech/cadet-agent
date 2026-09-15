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
  'MCPSetup.md',
  'PlanningReview.md',
  'Handoff.md',
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
      'MCPSetup.md': 'cadet-mcp-setup.prompt.md',
      'Handoff.md': 'cadet-handoff.prompt.md',
    },
    extraPrompts: ['cadet-resume.prompt.md', 'cadet-planning-review.prompt.md'],
  },
  cursor: {
    baseDir: join(repoRoot, '.cursor'),
    rulesDir: '.cursor/rules',
    ruleFile: '.cursor/rules/cadet-agent.md',
    reviewerFile: '.cursor/rules/cadet-agent-reviewer.md',
    extraRules: ['.cursor/rules/cadet-planning-review.md'],
  },
  continue: {
    baseDir: join(repoRoot, '.continue'),
    rulesDir: '.continue/rules',
    ruleFile: '.continue/rules/cadet-agent.md',
    reviewerFile: '.continue/rules/cadet-agent-reviewer.md',
    configFile: '.continue/config.yaml',
    extraRules: ['.continue/rules/cadet-planning-review.md'],
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
      'MCPSetup.md': 'cadet-mcp-setup/SKILL.md',
      'PlanningReview.md': 'cadet-planning-review/SKILL.md',
      'Handoff.md': 'cadet-handoff/SKILL.md',
    },
    extraSkills: ['cadet-resume/SKILL.md'],
  },
  deepcode: {
    baseDir: join(repoRoot, '.agents'),
    skillsDir: join(repoRoot, '.agents', 'skills'),
    skillFile: '.agents/skills/cadet-agent/SKILL.md',
    reviewerFile: '.agents/skills/cadet-agent-reviewer/SKILL.md',
    skillToFile: {
      'Requirements.md': 'cadet-requirements/SKILL.md',
      'Architecture.md': 'cadet-architecture/SKILL.md',
      'Spike.md': 'cadet-spike/SKILL.md',
      'StoryBreakdown.md': 'cadet-breakdown/SKILL.md',
      'TDD.md': 'cadet-tdd/SKILL.md',
      'Debugging.md': 'cadet-debug/SKILL.md',
      'CodeReview.md': 'cadet-review/SKILL.md',
      'MCPSetup.md': 'cadet-mcp-setup/SKILL.md',
      'PlanningReview.md': 'cadet-planning-review/SKILL.md',
      'Handoff.md': 'cadet-handoff/SKILL.md',
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

// Strip frontmatter (and Continue's `description:` lines) so guards inspect the
// instruction body rather than registration metadata. Shared by the DRY guards.
function bodyOf(file, content) {
  let body = content;
  if (file.endsWith('.md') && body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  if (file.endsWith('config.yaml')) {
    body = body
      .split('\n')
      .filter((line) => !/^\s+description:/.test(line))
      .join('\n');
  }
  return body;
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
        'cadet-resume', 'cadet-mcp-setup', 'cadet-agent-reviewer',
        'cadet-planning-review', 'cadet-handoff',
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

  // ── Extra rule adapters (Cursor / Continue additional phase rules) ───────

  describe('Extra phase rules (Cursor / Continue)', () => {
    // Each extra rule maps to the canonical skill it points at, so the
    // canonical-target assertion tracks the real target rather than assuming
    // every extra rule is a PlanningReview rule.
    const extras = [
      ['.cursor/rules/cadet-planning-review.md', 'PlanningReview.md'],
      ['.continue/rules/cadet-planning-review.md', 'PlanningReview.md'],
      ['.cursor/rules/cadet-handoff.md', 'Handoff.md'],
      ['.continue/rules/cadet-handoff.md', 'Handoff.md'],
    ];

    it('has at least one extra phase rule', () => {
      assert.ok(extras.length >= 2, 'expected extra Cursor/Continue phase rules');
    });

    for (const [rel, canonical] of extras) {
      it(`extra rule ${rel} exists`, () => {
        assert.ok(fileExists(rel), `missing extra rule: ${rel}`);
      });

      it(`extra rule ${rel} has YAML frontmatter`, () => {
        const content = readFile(rel);
        assert.ok(content.startsWith('---'), `${rel} must start with YAML frontmatter`);
        assert.ok(content.includes('description:'), `${rel} frontmatter must include description`);
      });

      it(`extra rule ${rel} references its canonical skill`, () => {
        const content = readFile(rel);
        assert.ok(
          content.includes(`.cadet/agent/core/skills/${canonical}`),
          `${rel} must reference .cadet/agent/core/skills/${canonical}`
        );
      });
    }
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

  // ── Deep Code adapters ─────────────────────────────────────────────────

  describe('Deep Code', () => {
    const deepcode = ideAdapters['deepcode'];

    it('has base skill file', () => {
      assert.ok(fileExists(deepcode.skillFile), 'missing cadet-agent.md skill');
    });

    it('base skill references cadet-agent.md', () => {
      const content = readFile(deepcode.skillFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Deep Code base skill must reference cadet-agent.md'
      );
    });

    it('base skill references state.json', () => {
      const content = readFile(deepcode.skillFile);
      assert.ok(
        content.includes('.cadet/state.json') || content.includes('state.json'),
        'Deep Code base skill must reference state.json'
      );
    });

    it('base skill has YAML frontmatter with name', () => {
      const content = readFile(deepcode.skillFile);
      assert.ok(content.startsWith('---'), 'Deep Code base skill must start with YAML frontmatter');
      assert.ok(content.includes('name:'), 'Deep Code base skill frontmatter must include name');
    });

    it('base skill documents the permissions-based Git Guard (no hook)', () => {
      const content = readFile(deepcode.skillFile);
      assert.ok(
        content.includes('permissions'),
        'Deep Code base skill must direct users to permissions for Git Guard'
      );
      assert.ok(
        content.includes('mutate-git-log'),
        'Deep Code base skill must name the mutate-git-log scope'
      );
    });

    for (const [skill, skillFile] of Object.entries(deepcode.skillToFile)) {
      const fullPath = join(deepcode.skillsDir, skillFile);

      it(`has per-phase skill for ${skill}`, () => {
        assert.ok(fileExists(fullPath), `missing Deep Code skill: ${fullPath}`);
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
    }

    for (const extra of deepcode.extraSkills) {
      it(`has extra skill ${extra}`, () => {
        const path = join(deepcode.skillsDir, extra);
        assert.ok(fileExists(path), `missing extra Deep Code skill: ${path}`);
      });
    }

    it('has reviewer skill', () => {
      assert.ok(fileExists(deepcode.reviewerFile), 'missing cadet-agent-reviewer.md skill');
    });

    it('reviewer references cadet-agent.md', () => {
      const content = readFile(deepcode.reviewerFile);
      assert.ok(
        content.includes('.cadet/agent/core/cadet-agent.md'),
        'Deep Code reviewer must reference cadet-agent.md'
      );
    });

    it('skill frontmatter names are lowercase kebab-case and match folder names', () => {
      const entries = [
        deepcode.skillFile,
        deepcode.reviewerFile,
        ...Object.values(deepcode.skillToFile).map((f) => `.agents/skills/${f}`),
        ...deepcode.extraSkills.map((f) => `.agents/skills/${f}`),
      ];
      for (const rel of entries) {
        const content = readFile(rel);
        const nameMatch = content.match(/^name:\s*(\S+)\s*$/m);
        assert.ok(nameMatch, `${rel} must declare a name in frontmatter`);
        const name = nameMatch[1];
        assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${rel} name "${name}" must be lowercase kebab-case`);
        assert.ok(name.length <= 64, `${rel} name must be <= 64 chars`);
        const folder = rel.split('/').slice(-2)[0];
        assert.equal(name, folder, `${rel} frontmatter name must match its folder name`);
      }
    });
  });

  // ── DRY guard: adapters must not duplicate canonical content ───────────

  describe('Adapters do not duplicate canonical content', () => {
    const adapterFiles = [
      '.github/agents/cadet.agent.md',
      '.github/agents/cadet-agent-reviewer.agent.md',
      ...Object.values(ideAdapters['github-copilot'].skillToPrompt).map((p) => `.github/prompts/${p}`),
      ...ideAdapters['github-copilot'].extraPrompts.map((p) => `.github/prompts/${p}`),
      '.claude/skills/cadet-agent/SKILL.md',
      '.claude/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['claude-code'].skillToFile).map((f) => `.claude/skills/${f}`),
      ...ideAdapters['claude-code'].extraSkills.map((f) => `.claude/skills/${f}`),
      '.agents/skills/cadet-agent/SKILL.md',
      '.agents/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['deepcode'].skillToFile).map((f) => `.agents/skills/${f}`),
      ...ideAdapters['deepcode'].extraSkills.map((f) => `.agents/skills/${f}`),
      '.continue/rules/cadet-agent.md',
      '.continue/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['continue'].extraRules || []),
      '.continue/config.yaml',
      '.cursor/rules/cadet-agent.md',
      '.cursor/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['cursor'].extraRules || []),
    ];

    const forbiddenStrings = [
      'Given/When/Then acceptance criteria',
      'red/green test-first',
      'ADRDecisionTemplate',
      'Persistent-Failure Protocol',
      'Assumption audit',
      '## Process',
    ];

    // Match a structural XML element copied into an adapter (at line start),
    // while allowing prose that merely mentions the tag name inline.
    const structuralTag = /^\s*<\/?(?:role|instructions|context|input|process|output|completion|documents|document)\b/;

    for (const rel of adapterFiles) {
      it(`${rel} does not duplicate canonical content`, () => {
        const content = readFile(rel);
        const body = bodyOf(rel, content);
        for (const phrase of forbiddenStrings) {
          assert.ok(!body.includes(phrase), `${rel} must not contain "${phrase}"`);
        }
        for (const line of body.split('\n')) {
          assert.ok(!structuralTag.test(line), `${rel} must not contain structural tag element: ${line.trim()}`);
        }
      });
    }

    it('flat .claude/skills/cadet-agent.md does not exist', () => {
      assert.ok(!fileExists('.claude/skills/cadet-agent.md'), 'orphan flat skill must be removed');
    });
  });

  // ── Shape B guard: adapters must not restate identity/persona/role ──────
  //
  // An adapter's job is to POINT at core, not to restate it. The core skill
  // already opens with `You are executing the Cadet **<Skill>** skill.` and
  // already carries the `<role>` persona block, so any adapter that repeats
  // those statements is duplicating per-turn context. This guard is generic:
  // it derives the forbidden sentences from the core files themselves, so a
  // newly paraphrased identity line is caught without editing this test.

  describe('Shape B: adapters do not restate identity, persona, or role', () => {
    const allAdapters = [
      ...Object.values(ideAdapters['claude-code'].skillToFile).map((f) => `.claude/skills/${f}`),
      ...ideAdapters['claude-code'].extraSkills.map((f) => `.claude/skills/${f}`),
      '.claude/skills/cadet-agent/SKILL.md',
      '.claude/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['deepcode'].skillToFile).map((f) => `.agents/skills/${f}`),
      ...ideAdapters['deepcode'].extraSkills.map((f) => `.agents/skills/${f}`),
      '.agents/skills/cadet-agent/SKILL.md',
      '.agents/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['github-copilot'].skillToPrompt).map((p) => `.github/prompts/${p}`),
      ...ideAdapters['github-copilot'].extraPrompts.map((p) => `.github/prompts/${p}`),
      '.cursor/rules/cadet-agent.md',
      '.cursor/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['cursor'].extraRules || []),
      '.continue/rules/cadet-agent.md',
      '.continue/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['continue'].extraRules || []),
      '.github/agents/cadet.agent.md',
      '.github/agents/cadet-agent-reviewer.agent.md',
    ];

    const forbiddenShapeB = [
      'You are executing the Cadet',
      'You are the **Cadet Agent Reviewer**',
      'You are a framework-compliance auditor',
      'implement, fix, or generate code',
      'never implement, fix',
      'review and report only',
    ];

    // Derive the real core sentences so the guard tracks core content, not a
    // hand-maintained list. We take the first sentence of each core skill's
    // <role> block and of its <instructions> block.
    function firstSentence(text) {
      const m = text.match(/[^.!?]*[.!?]/);
      return m ? m[0].trim() : '';
    }

    function coreSentences() {
      const out = [];
      for (const skill of [...expectedSkills, 'AgentReviewer.md']) {
        const content = readFileSync(join(skillsDir, skill), 'utf-8');
        const role = content.match(/<role>([\s\S]*?)<\/role>/);
        const instructions = content.match(/<instructions>([\s\S]*?)<\/instructions>/);
        for (const block of [role, instructions]) {
          if (!block) continue;
          const sentence = firstSentence(block[1].replace(/\s+/g, ' ').trim());
          // Only sentences that are clearly identity/persona statements.
          if (sentence.length >= 30 && /^You are\b/.test(sentence)) {
            out.push({ skill, sentence });
          }
        }
      }
      return out;
    }

    for (const rel of allAdapters) {
      it(`${rel} does not restate core identity sentences`, () => {
        const body = bodyOf(rel, readFile(rel));
        for (const phrase of forbiddenShapeB) {
          assert.ok(
            !body.includes(phrase),
            `${rel} must not restate identity content: "${phrase}" (belongs in .cadet/agent/core/)`
          );
        }
      });
    }

    it('no adapter contains any core <role>/<instructions> opening sentence', () => {
      const sentences = coreSentences();
      assert.ok(sentences.length >= 8, 'expected to derive identity sentences from core skills');
      for (const rel of allAdapters) {
        const body = bodyOf(rel, readFile(rel));
        for (const { skill, sentence } of sentences) {
          assert.ok(
            !body.includes(sentence),
            `${rel} duplicates the opening sentence of ${skill}: "${sentence}"`
          );
        }
      }
    });
  });

  // ── Shape A guard: base adapters must not re-list canonical inventories ──

  describe('Shape A: base adapters do not re-state canonical blocks', () => {
    const baseAdapters = [
      '.claude/skills/cadet-agent/SKILL.md',
      '.agents/skills/cadet-agent/SKILL.md',
      '.cursor/rules/cadet-agent.md',
      '.continue/rules/cadet-agent.md',
      '.github/agents/cadet.agent.md',
    ];

    const forbiddenShapeA = [
      'Primary Instruction File',
      'Operational Files',
      'Important Paths',
      '| Claude Command |',
      '| Skill | Invocation | When to dispatch |',
      'Available skills:',
    ];

    for (const rel of baseAdapters) {
      it(`${rel} does not re-state canonical blocks`, () => {
        const body = bodyOf(rel, readFile(rel));
        for (const phrase of forbiddenShapeA) {
          assert.ok(
            !body.includes(phrase),
            `${rel} must not contain "${phrase}" (canonical content lives in .cadet/agent/core/)`
          );
        }
      });
    }

    it('no base adapter names three or more phase skills in one region', () => {
      const skillNames = [
        'Requirements', 'Architecture', 'Spike', 'StoryBreakdown', 'Story Breakdown',
        'TDD', 'Debugging', 'CodeReview', 'Code Review', 'Resume', 'MCPSetup', 'MCP Setup',
      ];
      for (const rel of baseAdapters) {
        const body = bodyOf(rel, readFile(rel));
        const lines = body.split('\n');
        // Slide a 12-line window; flag windows naming >= 3 distinct phase skills,
        // which indicates an embedded inventory rather than a pointer.
        for (let i = 0; i < lines.length; i++) {
          const window = lines.slice(i, i + 12).join('\n');
          const named = new Set(
            skillNames.filter((n) => new RegExp(`\\b${n}\\b`).test(window))
          );
          assert.ok(
            named.size < 3,
            `${rel} appears to embed a skill inventory (lines ${i + 1}-${i + 12} name: ${[...named].join(', ')})`
          );
        }
      }
    });

    it('flat .claude base skill contains no markdown table', () => {
      const body = bodyOf('.claude/skills/cadet-agent/SKILL.md', readFile('.claude/skills/cadet-agent/SKILL.md'));
      const tableLines = body.split('\n').filter((l) => /^\s*\|/.test(l));
      assert.equal(tableLines.length, 0, 'base skill must not contain a markdown table');
    });
  });

  // ── Budget guard: byte ceilings prevent silent re-bloat ──────────────────

  describe('Adapter size budgets', () => {
    const baseAdapters = {
      '.claude/skills/cadet-agent/SKILL.md': { max: 1400, label: 'Claude base skill' },
      '.agents/skills/cadet-agent/SKILL.md': { max: 1400, label: 'Deep Code base skill' },
      '.cursor/rules/cadet-agent.md': { max: 1400, label: 'Cursor rule' },
      '.continue/rules/cadet-agent.md': { max: 1600, label: 'Continue rule' },
      '.github/agents/cadet.agent.md': { max: 2000, label: 'Copilot agent' },
    };

    for (const [rel, { max, label }] of Object.entries(baseAdapters)) {
      it(`${label} stays under ${max} bytes`, () => {
        const size = Buffer.byteLength(readFile(rel), 'utf-8');
        assert.ok(
          size <= max,
          `${rel} is ${size} bytes (budget ${max}). Adapters are pointers — move content to .cadet/agent/core/.`
        );
      });
    }

    it('per-phase adapters stay under 700 bytes', () => {
      const perPhase = [
        ...Object.values(ideAdapters['claude-code'].skillToFile).map((f) => `.claude/skills/${f}`),
        ...Object.values(ideAdapters['deepcode'].skillToFile).map((f) => `.agents/skills/${f}`),
      ];
      for (const rel of perPhase) {
        const size = Buffer.byteLength(readFile(rel), 'utf-8');
        assert.ok(size <= 700, `${rel} is ${size} bytes; per-phase adapters must stay pointers`);
      }
    });
  });

  // ── Discovery guard: mechanical adapter<->core sentence overlap ──────────
  //
  // The guards above assert KNOWN duplication patterns. This one does not need
  // to know the answer: it normalizes every sentence in every adapter and every
  // core file and flags sentences that appear in both. The historical failures
  // in this repo were patterns nobody had enumerated, so this is the guard that
  // can find what the others cannot.
  //
  // Known limit: it catches verbatim/near-verbatim duplication, NOT paraphrase.
  // That is why the plan's Phase 3F adversarial re-read remains required.

  describe('Discovery guard: adapter/core sentence overlap', () => {
    const allowlist = [
      // Pointer sentences legitimately name the same core paths. Keep this list
      // SHORT and justify every entry; it is the record of what was judged
      // acceptable rather than duplication.
      'read `.cadet/agent/core/cadet-agent.md`',
    ];

    function normalizeSentences(text, { stripFrontmatter = true } = {}) {
      let body = text;
      if (stripFrontmatter && body.startsWith('---')) {
        const end = body.indexOf('\n---', 3);
        if (end !== -1) body = body.slice(end + 4);
      }
      body = body
        .replace(/`[^`]*`/g, ' ')       // drop inline code (paths etc.)
        .replace(/[*_>#|]/g, ' ')        // drop markdown emphasis/headers/tables
        .replace(/\s+/g, ' ');
      const parts = body
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 40);
      return parts;
    }

    function coreSentenceSet() {
      const set = new Map();
      const coreFiles = [
        join(coreDir, 'cadet-agent.md'),
        ...expectedSkills.map((s) => join(skillsDir, s)),
        join(skillsDir, 'AgentReviewer.md'),
      ];
      for (const file of coreFiles) {
        if (!existsSync(file)) continue;
        for (const s of normalizeSentences(readFileSync(file, 'utf-8'))) {
          if (!set.has(s)) set.set(s, file);
        }
      }
      return set;
    }

    const adapterFiles = [
      '.claude/skills/cadet-agent/SKILL.md',
      '.claude/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['claude-code'].skillToFile).map((f) => `.claude/skills/${f}`),
      ...ideAdapters['claude-code'].extraSkills.map((f) => `.claude/skills/${f}`),
      '.agents/skills/cadet-agent/SKILL.md',
      '.agents/skills/cadet-agent-reviewer/SKILL.md',
      ...Object.values(ideAdapters['deepcode'].skillToFile).map((f) => `.agents/skills/${f}`),
      ...ideAdapters['deepcode'].extraSkills.map((f) => `.agents/skills/${f}`),
      ...Object.values(ideAdapters['github-copilot'].skillToPrompt).map((p) => `.github/prompts/${p}`),
      ...ideAdapters['github-copilot'].extraPrompts.map((p) => `.github/prompts/${p}`),
      '.github/agents/cadet.agent.md',
      '.github/agents/cadet-agent-reviewer.agent.md',
      '.cursor/rules/cadet-agent.md',
      '.cursor/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['cursor'].extraRules || []),
      '.continue/rules/cadet-agent.md',
      '.continue/rules/cadet-agent-reviewer.md',
      ...(ideAdapters['continue'].extraRules || []),
    ];

    it('reports zero un-allowlisted adapter/core sentence overlaps', () => {
      const core = coreSentenceSet();
      const hits = [];
      for (const rel of adapterFiles) {
        // Strip frontmatter in all cases. Leaving it in glues the closing `---`
        // onto the first body sentence and silently defeats matching.
        for (const s of normalizeSentences(readFile(rel))) {
          if (!core.has(s)) continue;
          if (allowlist.some((a) => s.includes(a))) continue;
          hits.push(`${rel}: "${s.slice(0, 100)}" (core: ${core.get(s)})`);
        }
      }
      assert.equal(
        hits.length,
        0,
        `Adapter/core sentence overlap detected:\n  ${hits.join('\n  ')}`
      );
    });

    // Self-test: prove the detector can actually FAIL. A discovery guard that
    // only ever returns "clean" is worse than no guard, because it launders the
    // absence of verification into a green test. An earlier revision of this
    // guard was exactly that: frontmatter gluing defeated matching, and this
    // self-test is what exposed it.
    it('detects an injected verbatim duplication (guard is not a no-op)', () => {
      const core = coreSentenceSet();
      assert.ok(core.size > 0, 'core sentence set must not be empty');
      const knownDuplicate = 'do not drift into open-ended design or premature optimization.';
      assert.ok(
        core.has(knownDuplicate),
        'fixture sentence must exist in core, otherwise this self-test proves nothing'
      );

      const real = readFile('.claude/skills/cadet-tdd/SKILL.md');
      const injected = real.replace('## Primary Context', `${knownDuplicate}\n\n## Primary Context`);
      const hits = normalizeSentences(injected).filter((s) => core.has(s));
      assert.ok(
        hits.includes(knownDuplicate),
        'detector failed to flag a verbatim core sentence injected into an adapter'
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
      '.github/prompts/cadet-mcp-setup.prompt.md',
      '.github/prompts/cadet-planning-review.prompt.md',
      // Cursor
      '.cursor/rules/cadet-agent.md',
      '.cursor/rules/cadet-agent-reviewer.md',
      '.cursor/rules/cadet-planning-review.md',
      // Continue
      '.continue/rules/cadet-agent.md',
      '.continue/rules/cadet-agent-reviewer.md',
      '.continue/rules/cadet-planning-review.md',
      '.continue/config.yaml',
      // Claude Code
      '.claude/skills/cadet-agent',
      '.claude/skills/cadet-agent-reviewer',
      '.claude/skills/cadet-planning-review',
      '.claude/skills/cadet-requirements',
      '.claude/skills/cadet-architecture',
      '.claude/skills/cadet-spike',
      '.claude/skills/cadet-breakdown',
      '.claude/skills/cadet-tdd',
      '.claude/skills/cadet-debug',
      '.claude/skills/cadet-review',
      '.claude/skills/cadet-resume',
      '.claude/skills/cadet-mcp-setup',
      // Deep Code (cross-client skills root)
      '.agents/skills/cadet-agent',
      '.agents/skills/cadet-agent-reviewer',
      '.agents/skills/cadet-requirements',
      '.agents/skills/cadet-architecture',
      '.agents/skills/cadet-spike',
      '.agents/skills/cadet-breakdown',
      '.agents/skills/cadet-tdd',
      '.agents/skills/cadet-debug',
      '.agents/skills/cadet-review',
      '.agents/skills/cadet-resume',
      '.agents/skills/cadet-mcp-setup',
      '.agents/skills/cadet-planning-review',
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

    // Mechanical drift guard: every adapter directory that exists on disk must be
    // listed in managedPaths, and every managed adapter path must exist. This is
    // stronger than the hand-maintained `allExpected` list above — it catches a
    // new adapter that was added to the tree but forgotten in the manifest (which
    // would silently drop it from the shipped package).
    for (const skillsRoot of ['.claude/skills', '.agents/skills']) {
      const abs = join(repoRoot, skillsRoot.replace(/\//g, '/'));
      const dirs = readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${skillsRoot}/${e.name}`);

      it(`every directory under ${skillsRoot} is in managedPaths`, () => {
        const missing = dirs.filter((d) => !managed.includes(d));
        assert.deepEqual(missing, [], `FrameworkManifest.json missing managed paths: ${missing.join(', ')}`);
      });

      it(`every managed path under ${skillsRoot} exists on disk`, () => {
        const declared = managed.filter((m) => m.startsWith(`${skillsRoot}/`));
        const absent = declared.filter((m) => !existsSync(resolvePath(m)));
        assert.deepEqual(absent, [], `managed paths missing from the source tree: ${absent.join(', ')}`);
      });
    }

    it('ships AGENTS.md but marks it create-only (never overwrites a consumer copy)', () => {
      assert.ok(
        managed.includes('AGENTS.md'),
        'AGENTS.md must be managed so fresh installs create it'
      );
      const createOnly = (manifest.createOnlyPaths || []).map((p) => p.replace(/\\/g, '/'));
      assert.ok(
        createOnly.includes('AGENTS.md'),
        'AGENTS.md must be listed in createOnlyPaths: install/sync must never overwrite a consumer copy'
      );
      // Every create-only path must also be managed, otherwise the package would
      // not contain the file to create.
      for (const p of createOnly) {
        assert.ok(managed.includes(p), `createOnly path "${p}" must also be in managedPaths`);
      }
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

    it('Deep Code base skill does not duplicate skill content', () => {
      checkNoDuplication('.agents/skills/cadet-agent/SKILL.md', 'Deep Code base skill');
    });
  });
});
