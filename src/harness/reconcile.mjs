/**
 * Artifact reconciliation — does the planning chain still agree with itself?
 *
 * Why this exists: every per-story check can pass while the chain as a whole
 * stops making sense. A story gets renamed and its neighbours still point at the
 * old file; a story is marked done in state while its markdown still says
 * planned; a deferral names a work item that finished three stories ago; an epic
 * directory exists that no plan mentions. Each is a claim in one artifact that
 * another artifact contradicts, and nothing looked at more than one document at a
 * time — `designArtifactSyncConfirmed` ("Requirements, design, plan, epics
 * mutually consistent") is the one gate on `validation -> closed` and, before
 * this module, nothing in the codebase could back it.
 *
 * Scope. This module reads the planning tree and reports what it can *prove*
 * from the artifacts themselves. It does not and cannot judge whether a design
 * decision is still honoured, whether two requirements contradict each other, or
 * whether the project drifted from its intent — that is the Reconciliation
 * skill's semantic pass. The split is deliberate: a check that cannot be
 * mechanised must not be dressed up as one, because a prose assertion that
 * nothing verifies is the exact shape `docs/core/HarnessContract-v4.md` §0.1
 * names as the anti-pattern.
 *
 * Gaps are reported for work that is still OPEN, not for history. A field added
 * to a template in one release is not retroactively owed by every document
 * written before it, and a check that says so fires on a correct project — which
 * is how a report teaches its reader to ignore it. That is not a theory: the
 * first version of this module was run against a real 88-story project and
 * produced 15 blocking findings for epics that merely lived one directory deeper,
 * two more for documents that existed under other names, and ~120 warnings for
 * fields that predated the templates. So: a reachability declaration is owed by a
 * story in flight (it is written during implementation), a witness checkpoint by
 * an epic that is not closed, and a `done` story's evidence ALWAYS — a completion
 * claim has to be traceable whenever it was made, and the framework's answer to
 * an accepted historical gap is a recorded gate-exception, not silence.
 *
 * Discovery is by content, not by path: an epic is a directory containing
 * `epic.md` wherever it sits, and a required document is matched by filename
 * pattern wherever it sits, because a real project nests its artifacts under a
 * named project folder and calls its requirements `mvp-requirements.md`.
 *
 * Read-only. It writes nothing: no state, no ledger, no report. The skill authors
 * the report from this verdict.
 *
 * The honesty rule. `verdict` is `unknown` whenever any artifact or required
 * field could not be read, because a clean verdict must never be reachable from
 * input the module could not parse — "an unparseable report proves nothing"
 * (`src/cli.mjs` verify-acs).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';

import { PHASES } from './policy.mjs';
import {
  collectWorkItems,
  parseReachabilityDeclaration,
  validateReachabilityDeclaration,
} from './reachability.mjs';

/** Where the framework puts planning artifacts when a policy does not relocate them. */
export const PLANS_DEFAULT_DIR = '.cadet/agent/project-plans';

/**
 * The documents a large change is expected to produce, matched by filename
 * PATTERN rather than by a fixed path.
 *
 * The fixed-path version of this check was wrong in practice. A real project
 * (`dolven-tactics`) keeps its artifacts under a named project folder with its
 * own document names — `.cadet/agent/project-plans/dolven-tactics-mvp/
 * mvp-requirements.md` — so looking for `requirements.md` at the plans root
 * reported two blocking findings against a project that had both documents. A
 * check that fires on a correct project is worse than no check: it teaches the
 * reader to ignore the output. Discovery is bounded and the path that satisfied
 * each one is reported, so the reader can see which file counted.
 *
 * `project-plan.md` is advisory rather than required: no skill in the dispatch
 * table produces one (Requirements, Architecture and StoryBreakdown cover the
 * others), so demanding it would report a gap for a document the workflow never
 * asked for.
 */
export const REQUIRED_ARTIFACTS = [
  { name: 'requirements', pattern: /requirements[^/\\]*\.md$/i, fromPhase: 'architectureComplete', severity: 'blocking' },
  { name: 'technical-design', pattern: /technical-design[^/\\]*\.md$/i, fromPhase: 'story-breakdown', severity: 'blocking' },
  { name: 'project-plan', pattern: /project-plan[^/\\]*\.md$/i, fromPhase: null, severity: 'info' },
];

export const RECONCILE_SEVERITIES = ['blocking', 'warning', 'info'];
export const RECONCILE_VERDICTS = ['consistent', 'findings', 'unknown'];

/** A planning document larger than this is not read; the bound keeps a runaway file from stalling a run. */
export const DEFAULT_MAX_DOC_BYTES = 256 * 1024;

/**
 * How deep the planning tree is walked. Real layouts nest: a project folder, then
 * `epics/`, then `epic-N/`. Three levels is not enough to assume, so the walk is
 * bounded rather than shallow — and bounded rather than unbounded so a symlink
 * loop or a stray `node_modules` cannot turn a read into a crawl.
 */
export const MAX_SCAN_DEPTH = 5;

/** Directories never worth scanning in a game repo. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'Library', 'obj', 'Temp', 'Logs', 'Build', 'UserSettings']);

const SEVERITY_RANK = { blocking: 0, warning: 1, info: 2 };

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function repoRelative(targetDir, abs) {
  const rel = toPosix(relative(targetDir, abs));
  return rel || '.';
}

/** 1-based line of the first match, for citing a finding back to its source. */
function lineOf(text, pattern) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return null;
}

/** The body of a `## Heading` section, up to the next `## ` heading. */
function sectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const wanted = heading.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m && m[1].toLowerCase() === wanted) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/**
 * The path a link field points at. The templates allow either a bare path or a
 * markdown link (`[text](../epic.md)`), and a consumer may write either, so both
 * are accepted rather than one being silently unresolvable.
 */
function linkTarget(value) {
  if (!value) return null;
  const md = String(value).match(/\]\(([^)]+)\)/);
  const raw = (md ? md[1] : String(value)).trim().replace(/^<|>$/g, '');
  if (!raw || /^(none|n\/a|todo|tbd)$/i.test(raw)) return null;
  return raw;
}

/**
 * Every path-like candidate in a link field.
 *
 * The template's `fmt="link"` promises one path, but a real epic wrote three
 * separated by `·` with parenthetical annotations — `a.md (note) · b.md (note)`
 * — and treating that whole string as one filename reported a perfectly good
 * link as dangling. A link field is satisfied when ANY candidate resolves.
 */
function linkCandidates(value) {
  if (!value) return [];
  const text = String(value);
  const out = [];
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) out.push(m[1]);
  const withoutMarkdown = text.replace(/\[[^\]]*\]\([^)]*\)/g, ' · ');
  for (const part of withoutMarkdown.split(/[·,;|]/)) {
    const token = part.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)[0];
    if (token && /\.md$/i.test(token)) out.push(token);
  }
  return [...new Set(out.map((s) => s.trim().replace(/^<|>$/g, '')))]
    .filter((s) => s && !/^(none|n\/a|todo|tbd)$/i.test(s));
}

/**
 * Does a story's declared link resolve?
 *
 * The story template writes `Parent Epic: ../epic.md`, while the documented
 * layout puts `epic.md` in the *same* directory as its stories (see
 * `docs/templates/EpicTemplate.md`'s directory listing, and
 * `reachability.readSiblingDeclarations`, which finds siblings in that same
 * directory). Both readings are accepted here, so neither convention is reported
 * as broken — but a wrong *filename* still is, which is the case worth catching.
 */
function resolvesStoryLink(storyPath, target) {
  if (isAbsolute(target)) return existsSync(target);
  if (existsSync(join(storyPath, '..', target))) return true;
  return existsSync(join(storyPath, '..', basename(target)));
}

function readBounded(path, maxBytes) {
  try {
    const stat = statSync(path);
    if (stat.size > maxBytes) return { error: `file is ${stat.size} bytes, above the ${maxBytes}-byte read bound` };
    return { text: readFileSync(path, 'utf-8') };
  } catch (err) {
    return { error: `cannot read: ${err.message}` };
  }
}

/**
 * The fields a story must carry for the structural checks to run at all. A field
 * that cannot be read is reported, never defaulted away: a missing `Status` must
 * not silently read as "no mismatch".
 */
export function parseStoryHeader(text) {
  const field = (label) => {
    const m = text.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    storyId: (text.match(/^(EPIC-\d+-STORY-\d+)\s*$/m) || [])[1] ?? null,
    status: field('Status') || null,
    parentEpic: field('Parent Epic') || null,
    reachability: field('Reachability') || null,
    designRefs: field('Design refs') || null,
    statusLine: lineOf(text, /^Status:/),
  };
}

export function parseEpicHeader(text) {
  const field = (label) => {
    const m = text.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const stories = sectionBody(text, 'Stories');
  return {
    epicId: (text.match(/^(EPIC-\d+)\s*$/m) || [])[1] ?? null,
    status: field('Status') || null,
    requirementsLinks: linkCandidates(field('Requirements')),
    technicalDesignLinks: linkCandidates(field('Technical Design')),
    witnessCheckpoint: sectionBody(text, 'Witness checkpoint'),
    declaredStoryCount: stories
      ? (stories.split(/\r?\n/).filter((l) => /^\s*-\s+\[/.test(l)).length || null)
      : null,
    statusLine: lineOf(text, /^Status:/),
  };
}

/**
 * Every directory under `root`, breadth-first and depth-bounded. Skipping the
 * usual game-repo ballast keeps a walk of a real project cheap.
 */
function walkDirs(root, maxDepth = MAX_SCAN_DEPTH) {
  const found = [];
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next = [];
    for (const dir of level) {
      found.push(dir);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        next.push(join(dir, entry.name));
      }
    }
    level = next;
  }
  return found;
}

/** The first file under `root` whose name matches, or null. */
function findDoc(root, pattern) {
  for (const dir of walkDirs(root)) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      return join(dir, entry.name);
    }
  }
  return null;
}

/**
 * Walk the planning tree. Returns what exists and what could be read — nothing is
 * interpreted here, so a caller can report an unreadable tree as such.
 *
 * Both the epics and the documents are DISCOVERED rather than assumed to sit at a
 * fixed depth. Real layouts nest (`<project>/epics/epic-N/`) and name their own
 * documents, and a reconciler that assumes the packaged template's layout reports
 * a correct project as broken.
 */
export function collectArtifacts(targetDir, {
  plansDir = PLANS_DEFAULT_DIR,
  story = null,
  maxBytes = DEFAULT_MAX_DOC_BYTES,
} = {}) {
  const root = isAbsolute(plansDir) ? plansDir : join(targetDir, plansDir);
  if (!existsSync(root)) {
    return { available: false, reason: `no planning artifacts at ${toPosix(plansDir)}`, root, docs: [], epics: [], scopedEpic: null };
  }

  const dirs = walkDirs(root);

  const docs = REQUIRED_ARTIFACTS.map(({ name, pattern }) => {
    const path = findDoc(root, pattern);
    return { name, path, relPath: path ? repoRelative(targetDir, path) : null, present: path !== null };
  });

  // Scope to one epic when a story path is given. State keys epics by directory
  // NAME (`epic-1-player-movement`), not by path, so the scope is that name — and
  // every epic lookup in this module uses the same key.
  let scopedEpic = null;
  if (story) {
    const abs = isAbsolute(story) ? story : join(targetDir, story);
    scopedEpic = basename(join(abs, '..'));
  }

  const epics = [];
  for (const dir of dirs) {
    const name = basename(dir);
    const epicFile = join(dir, 'epic.md');
    // An epic is identified by content, not by its directory name: a consumer may
    // name the folder anything, and `adr/`, `spikes/` and `evidence/` live in the
    // same tree — at whatever depth the project chose.
    if (!existsSync(epicFile)) continue;
    if (scopedEpic && name !== scopedEpic) continue;

    const epicRead = readBounded(epicFile, maxBytes);
    let storyFiles = [];
    try {
      storyFiles = readdirSync(dir)
        .filter((f) => /^story-.*\.md$/i.test(f))
        .sort();
    } catch { storyFiles = []; }

    const stories = storyFiles.map((file) => {
      const path = join(dir, file);
      const read = readBounded(path, maxBytes);
      return { file, path, relPath: repoRelative(targetDir, path), ...read };
    });

    epics.push({
      // `key` is the directory name, which is what state.json and work-item ids
      // use (`epic-1-foo::story-2.md`). `dir` is the repo-relative path, for
      // display only — conflating the two makes every lookup silently miss.
      key: name,
      dir: repoRelative(targetDir, dir),
      dirPath: dir,
      epicFile: { path: epicFile, relPath: repoRelative(targetDir, epicFile), ...epicRead },
      stories,
    });
  }

  epics.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return { available: true, reason: null, root, docs, epics, scopedEpic };
}

/**
 * Reconcile the planning tree against `state.json`.
 *
 * @returns {{ok: boolean, available: boolean, plansDir: string, verdict: string|null,
 *            findings: Array, summary: object, reason: string|null}}
 */
export function reconcileArtifacts(targetDir, {
  state = null,
  plansDir = PLANS_DEFAULT_DIR,
  story = null,
  maxBytes = DEFAULT_MAX_DOC_BYTES,
} = {}) {
  const collected = collectArtifacts(targetDir, { plansDir, story, maxBytes });
  const plansDirRel = toPosix(plansDir);

  if (!collected.available) {
    return {
      ok: true, available: false, plansDir: plansDirRel, verdict: null,
      findings: [], summary: { total: 0, blocking: 0, warning: 0, info: 0 },
      reason: collected.reason,
    };
  }

  const findings = [];
  const add = (code, severity, subject, artifact, detail, evidence = null) => {
    findings.push({ code, severity, subject, artifact, detail, evidence });
  };

  const stateEpics = state?.epics && typeof state.epics === 'object' ? state.epics : {};
  const phase = state?.session?.currentPhase ?? null;
  const workflowPath = state?.session?.workflowPath ?? null;
  const phaseIndex = PHASES.indexOf(phase);

  // ── 1. Required top-level documents ───────────────────────────────────────
  for (const { name, fromPhase, severity } of REQUIRED_ARTIFACTS) {
    const doc = collected.docs.find((d) => d.name === name);
    if (!doc || doc.present) continue;
    // Only expect a document once the workflow has reached the phase that
    // produces it, so an early-phase run does not report the future as a gap.
    const expected = fromPhase === null
      ? workflowPath === 'large'
      : phaseIndex >= 0 && phaseIndex >= PHASES.indexOf(fromPhase);
    if (!expected) continue;
    add('missing-artifact', severity, `${name}.md`, `${plansDirRel}/**`,
      fromPhase === null
        ? 'no project plan was found anywhere under the plans directory. No skill in the dispatch produces one, so this is advisory — but a large change is expected to have one.'
        : `no ${name} document was found anywhere under the plans directory, though the workflow reached \`${phase}\`. The chain has no root to reconcile against.`);
  }

  // ── 2. Epics: state vs disk, both directions ──────────────────────────────
  const onDisk = new Set(collected.epics.map((e) => e.key));
  for (const epicDir of Object.keys(stateEpics).sort()) {
    if (!onDisk.has(epicDir)) {
      add('missing-epic-dir', 'blocking', epicDir, `${plansDirRel}/${epicDir}`,
        'state.json tracks this epic, but no `epic.md` exists for it on disk. Every story under it is unreachable as an artifact.');
    }
  }

  for (const epic of collected.epics) {
    const stateEpic = stateEpics[epic.key];

    if (!stateEpic) {
      add('orphan-epic-dir', 'warning', epic.key, epic.epicFile.relPath,
        'this epic exists on disk but state.json does not track it. Nothing will ever mark its stories done.');
    }

    if (epic.epicFile.error) {
      add('unparsable-artifact', 'warning', epic.key, epic.epicFile.relPath,
        `the epic could not be read (${epic.epicFile.error}), so its status and links were not checked.`);
    } else {
      const header = parseEpicHeader(epic.epicFile.text);
      if (!header.status) {
        add('unparsable-artifact', 'warning', epic.key, epic.epicFile.relPath,
          'the epic has no readable `Status:` field, so its status was not reconciled.');
      }
      if (header.epicId === null) {
        add('unparsable-artifact', 'warning', epic.key, epic.epicFile.relPath,
          'the epic declares no `EPIC-N` id, so its identity was not checked.');
      }

      // Epic -> requirements / design links must resolve. A field may carry more
      // than one link, and it is satisfied when any one of them resolves.
      for (const [label, targets] of [['Requirements', header.requirementsLinks], ['Technical Design', header.technicalDesignLinks]]) {
        if (targets.length === 0) continue;
        const resolved = targets.some((t) => existsSync(isAbsolute(t) ? t : join(epic.dirPath, t)));
        if (!resolved) {
          add('dangling-epic-link', 'warning', epic.key, epic.epicFile.relPath,
            `the epic's \`${label}\` points at ${targets.map((t) => `\`${t}\``).join(', ')}, and none of them exist. The chain cannot be followed past this epic.`,
            `line ${lineOf(epic.epicFile.text, new RegExp(`^${label}:`)) ?? '?'}`);
        }
      }

      const epicStatus = String(stateEpic?.status ?? '').toLowerCase();
      const epicClosed = epicStatus === 'complete' || epicStatus === 'done';
      if (!header.witnessCheckpoint && !epicClosed) {
        add('missing-witness-checkpoint', 'warning', epic.key, epic.epicFile.relPath,
          'the epic declares no Witness checkpoint. The template marks it REQUIRED: without it, nothing states which story first makes the epic reachable.');
      }
    }

    if (epic.stories.length === 0) {
      add('epic-without-stories', 'warning', epic.key, epic.epicFile.relPath,
        'this epic directory contains no `story-*.md` files. An epic with no stories delivers nothing and cannot be reviewed.');
    }

    const stateStories = stateEpic?.stories && typeof stateEpic.stories === 'object' ? stateEpic.stories : {};
    const diskStories = new Set(epic.stories.map((s) => s.file));

    for (const file of Object.keys(stateStories).sort()) {
      if (!diskStories.has(file)) {
        add('missing-story-file', 'blocking', `${epic.key}::${file}`, `${plansDirRel}/${epic.key}/${file}`,
          'state.json tracks this story, but its markdown file is absent. Its acceptance criteria are no longer written down anywhere.');
      }
    }
    for (const storyFile of epic.stories) {
      if (!Object.hasOwn(stateStories, storyFile.file)) {
        add('orphan-story-file', 'warning', `${epic.key}::${storyFile.file}`, storyFile.relPath,
          'this story file is not tracked in state.json. It will never be marked done, and no gate refers to it.');
      }
    }

    // ── 3. Per-story checks ─────────────────────────────────────────────────
    for (const storyFile of epic.stories) {
      const subject = `${epic.key}::${storyFile.file}`;

      if (storyFile.error) {
        add('unparsable-artifact', 'warning', subject, storyFile.relPath,
          `the story could not be read (${storyFile.error}), so none of its fields were reconciled.`);
        continue;
      }

      const header = parseStoryHeader(storyFile.text);

      if (!header.status) {
        add('unparsable-artifact', 'warning', subject, storyFile.relPath,
          'the story has no readable `Status:` field, so it was not reconciled against state.json.');
      }

      // Story status vs state status.
      const stateStatus = stateStories[storyFile.file];
      const stateStatusLower = String(stateStatus).toLowerCase();
      const isDone = stateStatusLower === 'done';
      const isInFlight = stateStatusLower === 'in-progress';
      if (header.status && stateStatus) {
        const md = header.status.toLowerCase();
        const st = String(stateStatus).toLowerCase();
        const agree = md === st || (md === 'done' && st === 'done') || (md === 'in progress' && st === 'in-progress');
        if (!agree) {
          add('status-mismatch', 'warning', subject, storyFile.relPath,
            `the story file says \`${header.status}\` while state.json says \`${stateStatus}\`. One of the two is the record and the other is stale, and a reader cannot tell which.`,
            `line ${header.statusLine ?? '?'}`);
        }
      }

      // Parent Epic link must resolve.
      const parent = linkTarget(header.parentEpic);
      if (parent) {
        if (!resolvesStoryLink(storyFile.path, parent)) {
          add('dangling-parent-epic', 'blocking', subject, storyFile.relPath,
            `\`Parent Epic: ${header.parentEpic}\` does not resolve. The story has no epic, so nothing owns its completion.`,
            `line ${lineOf(storyFile.text, /^Parent Epic:/) ?? '?'}`);
        }
      } else {
        add('unparsable-artifact', 'warning', subject, storyFile.relPath,
          'the story declares no readable `Parent Epic:`, so its place in the chain was not checked.');
      }

      // Reachability: reuse the shipped validator so reconcile and
      // verify-reachability cannot disagree about the same declaration.
      const declaration = parseReachabilityDeclaration(storyFile.path);
      const workItems = state ? collectWorkItems(state) : null;
      const verdict = validateReachabilityDeclaration(declaration, { workItems, self: subject });
      if (!verdict.ok) {
        if (verdict.code === 'malformed') {
          add('unparsable-artifact', 'warning', subject, storyFile.relPath,
            `the reachability declaration could not be parsed: ${verdict.message}`);
        } else if (verdict.code === 'not-declared') {
          // The declaration is written DURING implementation, so only a story in
          // flight owes one. A story that has not started has nothing truthful to
          // declare yet, and a story that closed before the field existed is
          // history — reporting either buries the findings that are real.
          if (isInFlight) {
            add('missing-reachability', 'warning', subject, storyFile.relPath,
              'this story is in progress but declares no reachability. The declaration is required before it can pass review, and nothing yet states how its deliverable is reached.');
          }
        } else if (verdict.code === 'deferral-target-done') {
          add('expired-deferral', 'blocking', subject, storyFile.relPath, verdict.message);
        } else {
          add('unresolved-deferral', 'warning', subject, storyFile.relPath, verdict.message);
        }
      }

      // A story state calls done must own evidence, or "done" is a claim with
      // nothing behind it.
      if (isDone) {
        const row = state?.evidenceCoverage?.[subject]
          ?? Object.values(state?.evidenceCoverage ?? {}).find((r) => r?.workItemId === subject);
        const count = Number(row?.recordCount ?? 0);
        if (!row || !Number.isFinite(count) || count <= 0) {
          add('done-without-evidence', 'blocking', subject, storyFile.relPath,
            'state.json marks this story done, but no evidence record is indexed against it. The completion cannot be traced to anything that ran.');
        }
      }
    }
  }

  // ── 4. Sort, number, and summarise ────────────────────────────────────────
  findings.sort((a, b) => {
    const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (s !== 0) return s;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });
  findings.forEach((f, i) => { f.id = `R-${i + 1}`; });

  const summary = {
    total: findings.length,
    blocking: findings.filter((f) => f.severity === 'blocking').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  // An unreadable input cannot yield a clean verdict, whatever else was found.
  //
  // Only blocking and warning findings make the chain inconsistent. An `info`
  // finding is advisory — the project-plan check is one — and folding it into the
  // verdict would mean no project could ever be called consistent without a
  // document no skill produces, which would make the verdict useless rather than
  // strict.
  const anythingUnparsable = findings.some((f) => f.code === 'unparsable-artifact');
  const inconsistent = summary.blocking > 0 || summary.warning > 0;
  const verdict = anythingUnparsable ? 'unknown' : inconsistent ? 'findings' : 'consistent';

  return {
    ok: true,
    available: true,
    plansDir: plansDirRel,
    scopedEpic: collected.scopedEpic,
    verdict,
    findings,
    summary,
    artifacts: {
      docs: collected.docs.map((d) => ({ name: d.name, present: d.present, path: d.relPath })),
      epicCount: collected.epics.length,
      storyCount: collected.epics.reduce((n, e) => n + e.stories.length, 0),
    },
    reason: null,
  };
}
