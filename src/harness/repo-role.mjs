import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Repository role detection.
 *
 * Cadet is consumed two different ways:
 *
 * - `consumer-project` — the normal case: a Unity/game repository that installs
 *   Cadet and runs the workflow. It has `.cadet/state.json` (or will, once the
 *   first story starts) and planning artifacts under `.cadet/agent/project-plans/`.
 * - `framework-source` — the canonical Cadet-Agent repository itself (and any
 *   fork of it). It ships the *rules about* stories and gates but deliberately
 *   holds no `.cadet/state.json` and no `.cadet/agent/project-plans/`; those are
 *   listed in CONTRIBUTING.md as "not in this repo".
 *
 * Why this exists: an agent dropped into the framework-source repo sees a tree
 * full of gate vocabulary (`codeReviewCompleted`, Given/When/Then, story
 * templates) with no active work item, and can be led to reason about stories
 * that were never there. Detecting the role lets the CLI and the skills say so
 * explicitly instead of reporting a bare success for a missing state file.
 */

export const REPO_ROLES = Object.freeze({
  CONSUMER: 'consumer-project',
  FRAMEWORK: 'framework-source',
});

/** Relative path of the marker file written by install/sync. */
export const REPO_ROLE_MARKER = '.cadet/.repo-role';

/** Higher confidence wins when both a marker and structural signals are present. */
const CONFIDENCE = Object.freeze({ marker: 'high', structural: 'medium', unknown: 'low' });

function readMarker(targetDir) {
  const path = join(targetDir, '.cadet', '.repo-role');
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Detect the role of `targetDir`.
 *
 * Resolution order:
 *   1. Explicit `.cadet/.repo-role` marker (written by install/sync) — high confidence.
 *   2. Structural signals: an existing `.cadet/state.json` or a
 *      `.cadet/agent/project-plans/` directory ⇒ consumer-project; a
 *      FrameworkManifest.json with no state and no project-plans ⇒ framework-source.
 *   3. Otherwise `unknown`.
 *
 * Never throws: a malformed or unreadable marker degrades to structural signals.
 */
export function detectRepoRole(targetDir, { marker = undefined } = {}) {
  const explicit = marker === undefined ? readMarker(targetDir) : marker;

  if (explicit === REPO_ROLES.CONSUMER || explicit === REPO_ROLES.FRAMEWORK) {
    return {
      role: explicit,
      source: 'marker',
      confidence: CONFIDENCE.marker,
      marker: REPO_ROLE_MARKER,
    };
  }

  const hasState = existsSync(join(targetDir, '.cadet', 'state.json'));
  const hasPlans = existsSync(join(targetDir, '.cadet', 'agent', 'project-plans'));
  const hasManifest = existsSync(join(targetDir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'));

  if (hasState || hasPlans) {
    return {
      role: REPO_ROLES.CONSUMER,
      source: 'structural',
      confidence: CONFIDENCE.structural,
      signals: { hasState, hasPlans, hasManifest },
    };
  }

  if (hasManifest) {
    // Framework files are present but there is no story state and no plans tree:
    // this is the framework source (or a fork of it), not a mid-story project.
    return {
      role: REPO_ROLES.FRAMEWORK,
      source: 'structural',
      confidence: CONFIDENCE.structural,
      signals: { hasState, hasPlans, hasManifest },
    };
  }

  return {
    role: 'unknown',
    source: 'structural',
    confidence: CONFIDENCE.unknown,
    signals: { hasState, hasPlans, hasManifest },
  };
}

/** True when `targetDir` is the framework source and has no active work item. */
export function isFrameworkSourceWithoutWorkItem(targetDir) {
  const info = detectRepoRole(targetDir);
  if (info.role !== REPO_ROLES.FRAMEWORK) return false;
  return !existsSync(join(targetDir, '.cadet', 'state.json'));
}

/** Human-readable one-liner explaining the detected role and its consequence. */
export function describeRepoRole(info) {
  if (info.role === REPO_ROLES.FRAMEWORK) {
    return 'framework-source repository — story/gate work is not applicable here; use the contribution workflow (CONTRIBUTING.md).';
  }
  if (info.role === REPO_ROLES.CONSUMER) {
    return 'consumer-project repository — story/gate workflow applies.';
  }
  return 'unknown repository role — no Cadet install detected (run `cadet-agent init`).';
}
