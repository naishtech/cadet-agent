/**
 * Cadet-Agent state validation, legal transitions, and evidence-backed gates.
 *
 * Phase names, gate names, and the transition table are frozen compatibility
 * invariants (docs/core/HarnessContract.md §1). This module validates state v2,
 * migrates v1 → v2 atomically, rejects unsupported gate claims, and enforces
 * evidence freshness before any phase transition.
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PHASES, GATES, TRANSITIONS, EVIDENCE_STATUSES, DEFAULT_STRICT_CLOSURE,
  EXCEPTION_CATEGORIES, EXCEPTION_EXPIRY_DAYS, EXCEPTION_REQUIRES_REVIEW_NOTE,
} from './policy.mjs';
import { hashTree, hashFile, hashCriteria, timestamp, isUuid } from './util.mjs';
import { encodeEvidenceTrailers } from './gitmemo.mjs';

export { PHASES, GATES, TRANSITIONS, EVIDENCE_STATUSES };
export { EXCEPTION_CATEGORIES, EXCEPTION_EXPIRY_DAYS };

export const STATE_VERSION = 4;

/** Highest state version this module can read. v1/v2/v3 remain readable. */
export const READABLE_STATE_VERSIONS = Object.freeze([1, 2, 3, 4]);

/**
 * Version at which evidence history stopped living in `state.json` (contract v5).
 *
 * A v4 document keeps only the active work item's evidence inline: gate
 * exceptions live in their own field, `changeHistory` is no longer appended to,
 * and everything historical moves to commit trailers plus `.cadet/archive/`.
 *
 * The test is `>=` rather than `===` on purpose. A future version bump inherits
 * "history is external" instead of silently reverting to the unbounded growth
 * this version exists to remove — the failure mode being avoided is a version
 * check that quietly stops applying.
 */
export const HISTORY_EXTERNAL_SINCE = 4;

/** Is this document a version that keeps history out of `state.json`? */
export function isHistoryExternal(state) {
  const version = state?.version ?? state?.stateVersion;
  return typeof version === 'number' && version >= HISTORY_EXTERNAL_SINCE;
}

class StateError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'StateError';
    Object.assign(this, detail);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a state document. Returns `{ valid, errors, warnings }` — never throws
 * for user input so the CLI can report every problem at once.
 *
 * When `context.rootDir` is supplied, a claimed-true gate's supporting evidence is
 * also checked for work-item binding and input-tree freshness, so a stale or
 * foreign evidence record cannot make `state validate` report a false valid.
 *
 * Without `rootDir`, freshness cannot be checked; a warning is emitted so a
 * structural-only validation is never mistaken for a full gate-safety check.
 * Callers that validate state on disk should pass `rootDir`.
 */
export function validateState(state, context = {}) {
  const errors = [];
  const warnings = [];
  const rootDir = context.rootDir || null;
  const strict = resolveStrict(context);
  const hasTrueGate = isPlainObject(state) && isPlainObject(state.gates)
    && Object.values(state.gates).some((v) => v === true);
  if (!rootDir && hasTrueGate && context.structuralOnly !== true) {
    warnings.push({
      path: 'gateEvidence',
      message: 'gate freshness was not verified: no rootDir was supplied, so stale or foreign '
        + 'evidence cannot be detected. Pass { rootDir } to run the full check.',
    });
  }

  if (!isPlainObject(state)) {
    return { valid: false, errors: [{ path: '$', message: 'state must be a JSON object' }], warnings };
  }

  const version = state.version ?? state.stateVersion;
  if (!READABLE_STATE_VERSIONS.includes(version)) {
    errors.push({ path: 'version', message: `unsupported state version ${JSON.stringify(version)} (expected 1, 2, 3 or 4)` });
  }

  if (!isPlainObject(state.session)) {
    errors.push({ path: 'session', message: 'session must be an object' });
  } else {
    const s = state.session;
    for (const required of ['workflowPath', 'currentPhase', 'trackingMode']) {
      if (s[required] === undefined || s[required] === null) {
        errors.push({ path: `session.${required}`, message: `${required} is required` });
      }
    }
    if (s.currentPhase !== undefined && !PHASES.includes(s.currentPhase)) {
      errors.push({ path: 'session.currentPhase', message: `unknown phase "${s.currentPhase}"` });
    }
    if (s.workflowPath !== undefined && !['large', 'small', 'no_test_required'].includes(s.workflowPath)) {
      errors.push({ path: 'session.workflowPath', message: `unknown workflowPath "${s.workflowPath}"` });
    }
    if (s.trackingMode !== undefined && !['markdown', 'github'].includes(s.trackingMode)) {
      errors.push({ path: 'session.trackingMode', message: `unknown trackingMode "${s.trackingMode}"` });
    }
    if (s.learnerTier !== undefined && !['beginner', 'intermediate', 'advanced', 'guided'].includes(s.learnerTier)) {
      errors.push({ path: 'session.learnerTier', message: `unknown learnerTier "${s.learnerTier}"` });
    }
    if (s.operatingMode !== undefined && !['instruction-first', 'implementation-first', 'hybrid'].includes(s.operatingMode)) {
      errors.push({ path: 'session.operatingMode', message: `unknown operatingMode "${s.operatingMode}"` });
    }
  }

  if (state.epics !== undefined && !isPlainObject(state.epics)) {
    errors.push({ path: 'epics', message: 'epics must be an object' });
  }
  if (state.gates !== undefined && !isPlainObject(state.gates)) {
    errors.push({ path: 'gates', message: 'gates must be an object' });
  }
  if (state.gates && isPlainObject(state.gates)) {
    for (const key of Object.keys(state.gates)) {
      if (!GATES.includes(key)) {
        warnings.push({ path: `gates.${key}`, message: `unknown gate "${key}"` });
      } else if (typeof state.gates[key] !== 'boolean') {
        errors.push({ path: `gates.${key}`, message: `gate "${key}" must be a boolean` });
      }
    }
  }

  if (version >= 2 && version <= STATE_VERSION) {
    if (state.gateEvidence !== undefined && !Array.isArray(state.gateEvidence)) {
      errors.push({ path: 'gateEvidence', message: 'gateEvidence must be an array' });
    }
    if (Array.isArray(state.gateEvidence)) {
      state.gateEvidence.forEach((ev, i) => {
        for (const e of validateEvidenceShape(ev, strict)) errors.push({ path: `gateEvidence[${i}].${e.path}`, message: e.message });
      });
    }
    // Gate exceptions are categorised under strict closure (contract v3 §4).
    //
    // v4 gives them their own field, because they are *live state* — scoped to a
    // work item and bounded by `expiresAt`, and read by `activeExceptions` — and
    // filing live state in a history array is how the array grew without bound.
    // v1-v3 documents keep them in `changeHistory`, so both sources are read and
    // each is reported under the path it actually lives at.
    if (Array.isArray(state.changeHistory)) {
      state.changeHistory.forEach((entry, i) => {
        if (entry?.type !== 'gate-exception') return;
        if (!strict) return;
        for (const e of validateGateException(entry, strict)) {
          errors.push({ path: `changeHistory[${i}].${e.path}`, message: e.message });
        }
      });
    }
    if (state.gateExceptions !== undefined && !Array.isArray(state.gateExceptions)) {
      errors.push({ path: 'gateExceptions', message: 'gateExceptions must be an array' });
    }
    if (Array.isArray(state.gateExceptions)) {
      state.gateExceptions.forEach((entry, i) => {
        if (!isPlainObject(entry)) {
          errors.push({ path: `gateExceptions[${i}]`, message: 'gate exception must be an object' });
          return;
        }
        if (!strict) return;
        for (const e of validateGateException(entry, strict)) {
          errors.push({ path: `gateExceptions[${i}].${e.path}`, message: e.message });
        }
      });
    }
    // The coverage index (contract v5). It is what keeps the "a done story owns
    // evidence" check answerable once the records themselves have moved to
    // commits and `.cadet/archive/`, so a malformed index is an error: an index
    // that silently reads as empty would report every completed story as
    // unevidenced, and an index that reads as complete would hide real gaps.
    if (state.evidenceCoverage !== undefined && !isPlainObject(state.evidenceCoverage)) {
      errors.push({ path: 'evidenceCoverage', message: 'evidenceCoverage must be an object keyed by work item id' });
    }
    if (isPlainObject(state.evidenceCoverage)) {
      for (const [workItemId, row] of Object.entries(state.evidenceCoverage)) {
        if (!isPlainObject(row)) {
          errors.push({ path: `evidenceCoverage.${workItemId}`, message: 'coverage row must be an object' });
          continue;
        }
        if (!Number.isInteger(row.recordCount) || row.recordCount < 0) {
          errors.push({ path: `evidenceCoverage.${workItemId}.recordCount`, message: 'recordCount must be a non-negative integer' });
        }
        if (row.gates !== undefined && !Array.isArray(row.gates)) {
          errors.push({ path: `evidenceCoverage.${workItemId}.gates`, message: 'gates must be an array' });
        }
      }
    }
    // A claimed-true gate must be backed by evidence. This is rejected at
    // validation time (not only at transition time) so `state validate` cannot
    // report an unsupported gate as valid. When a rootDir is available, the
    // supporting record must also belong to the active work item and have a
    // fresh input tree hash.
    if (isPlainObject(state.gates)) {
      const activeWorkItem = isPlainObject(state.activeWorkItem) ? state.activeWorkItem : null;
      const workItemId = activeWorkItem
        ? `${activeWorkItem.epicId || 'none'}::${activeWorkItem.storyId || 'none'}`
        : null;

      // Gate exceptions are honoured here for the same reasons `evaluateTransition`
      // honours them. Before this, a scoped exception could make a transition legal
      // while `state validate` still reported the identical document as invalid, so
      // the two official commands contradicted each other and a reader could not tell
      // "correctly excepted" from "evidence broken". Exceptions are keyed on the
      // ACTIVE work item, so they cannot excuse a different story's gates.
      const exceptions = activeExceptions(state, { workItemId: workItemId || undefined });

      for (const gate of GATES) {
        if (state.gates[gate] !== true) continue;

        // An excepted gate is intentionally not held to freshness or work-item
        // ownership: that is precisely what the exception is for. It still must have
        // been claimed true, which the loop condition above already guarantees.
        if (exceptions[gate]) continue;

        const evidence = latestEvidenceForGate(state, gate);
        if (!evidence || (evidence.status !== 'passed' && evidence.status !== 'manual-confirmation')) {
          errors.push({
            path: `gates.${gate}`,
            message: `gate "${gate}" is true but has no supporting evidence record (status "passed" or "manual-confirmation")`,
          });
          continue;
        }
        if (workItemId && evidence.workItemId && evidence.workItemId !== workItemId) {
          errors.push({
            path: `gates.${gate}`,
            message: `gate "${gate}" is backed by evidence for work item "${evidence.workItemId}", not the active work item "${workItemId}"`,
          });
          continue;
        }
        if (rootDir) {
          const relevant = Array.isArray(evidence.relevantFiles) ? evidence.relevantFiles : [];
          const currentHash = computeInputTreeHash(rootDir, relevant);
          if (evidence.inputTreeHash && evidence.inputTreeHash !== currentHash) {
            errors.push({
              path: `gates.${gate}`,
              message: `gate "${gate}" is backed by stale evidence: the input tree hash no longer matches the current files`,
            });
            continue;
          }
        }
        if (evidence.expiresAt && Date.parse(evidence.expiresAt) <= Date.now()) {
          errors.push({
            path: `gates.${gate}`,
            message: `gate "${gate}" is backed by expired evidence (expired ${evidence.expiresAt})`,
          });
        }
      }
    }
    if (state.activeRunId !== undefined && state.activeRunId !== null && !isUuid(state.activeRunId)) {
      errors.push({ path: 'activeRunId', message: 'activeRunId must be a UUIDv4 or null' });
    }
    if (state.activeWorkItem !== undefined && state.activeWorkItem !== null) {
      if (!isPlainObject(state.activeWorkItem)) {
        errors.push({ path: 'activeWorkItem', message: 'activeWorkItem must be an object or null' });
      }
    }
    if (state.lastTransition !== undefined && state.lastTransition !== null) {
      const lt = state.lastTransition;
      if (!isPlainObject(lt)) {
        errors.push({ path: 'lastTransition', message: 'lastTransition must be an object or null' });
      } else {
        if (lt.from !== undefined && !PHASES.includes(lt.from)) errors.push({ path: 'lastTransition.from', message: `unknown phase "${lt.from}"` });
        if (lt.to !== undefined && !PHASES.includes(lt.to)) errors.push({ path: 'lastTransition.to', message: `unknown phase "${lt.to}"` });
      }
    }

    // AR-2. A story marked `done` must have SOME evidence record of its own.
    //
    // WHY THIS IS NEEDED. Every gate rule in this file is scoped to the ACTIVE
    // work item, so `state validate` could report a document as fully valid while
    // an already-completed story had no evidence whatsoever. In one real project
    // eight `done` stories had zero records and validation said "valid, 0 errors,
    // 0 warnings" — the gaps were invisible until they were looked for by hand.
    //
    // SCOPE, DELIBERATELY NARROW. This asserts COVERAGE, not gate completeness:
    // it asks only "is there any evidence for this story at all?". Whether every
    // required gate was satisfied for the right phase is already enforced at
    // transition time, against the active work item, where the phase is known.
    // Re-deciding that here would duplicate the transition matrix and risk the
    // two disagreeing.
    //
    // It is an ERROR, not a warning, because a `done` story with no evidence is
    // indistinguishable from a story that was never verified — which is the
    // condition the framework exists to prevent. Projects that closed stories
    // before the harness existed resolve it with a scoped `pre-harness-story`
    // exception naming the story's work item; silently tolerating it is what let
    // the gap grow.
    if (isPlainObject(state.epics) && Array.isArray(state.gateEvidence)) {
      const evidenced = new Set(
        state.gateEvidence
          .map((e) => (isPlainObject(e) ? e.workItemId : null))
          .filter((id) => typeof id === 'string' && id.length > 0),
      );
      // A v4 document archives a closed work item's records, so the inline array
      // is no longer the only evidence of coverage. The index is what remains,
      // and reading it here is what stops compaction from looking like loss:
      // without this, compacting a repository would report every already-done
      // story as unevidenced, and the fix for unbounded growth would be a false
      // accusation of missing evidence.
      if (isPlainObject(state.evidenceCoverage)) {
        for (const id of Object.keys(state.evidenceCoverage)) {
          if (typeof id === 'string' && id.length > 0) evidenced.add(id);
        }
      }
      // A scoped exception is the FIRST-CLASS escape for a permanent historical
      // gap. `activeExceptions` is keyed on the ACTIVE work item, which is the
      // current story — the wrong scope here, where we walk every completed story
      // — so the scope match is done explicitly against each story's work-item id.
      // Only a valid, categorised exception counts: an unknown category is not a
      // loophole, it is a typo, and `validateGateException` rejects it separately.
      const excepted = new Set();
      const exceptionSources = [
        ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
        ...(Array.isArray(state.gateExceptions) ? state.gateExceptions : []),
      ];
      for (const entry of exceptionSources) {
        if (!isPlainObject(entry) || entry.type !== 'gate-exception') continue;
        if (!EXCEPTION_CATEGORIES.includes(entry.category)) continue;
        const scope = Array.isArray(entry.scope) ? entry.scope : (entry.scope ? [entry.scope] : []);
        for (const s of scope) excepted.add(String(s));
      }
      for (const [epicId, epic] of Object.entries(state.epics)) {
        if (!isPlainObject(epic) || !isPlainObject(epic.stories)) continue;
        for (const [storyId, status] of Object.entries(epic.stories)) {
          if (status !== 'done') continue;
          const workItemId = `${epicId}::${storyId}`;
          if (evidenced.has(workItemId)) continue;
          if (excepted.has(workItemId)) continue;
          errors.push({
            path: `epics.${epicId}.stories.${storyId}`,
            message: `story "${storyId}" is marked done but has no evidence record for its work item `
              + `"${epicId}::${storyId}". A completed story must be backed by at least one evidence `
              + 'record; otherwise it is indistinguishable from one that was never verified.',
          });
        }
      }
    }
  } else if (state.gateEvidence !== undefined) {
    warnings.push({ path: 'gateEvidence', message: 'gateEvidence on a v1 state is ignored until migration' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate the shape of one evidence record.
 *
 * `strict` (contract v3 §3) is the resolved `strictClosure` policy, or null when
 * strict closure is off. When provided, a `manual-confirmation` record must carry
 * machine-checkable `reason`, `environment`, `scope`, and a real `expiresAt` —
 * because in v2 "declared the key" was accepted as "declared a bound", which let
 * an unbounded record satisfy a gate.
 */
function validateEvidenceShape(ev, strict = null) {
  const errors = [];
  if (!isPlainObject(ev)) return [{ path: '', message: 'evidence must be an object' }];
  // Required, non-null fields (contract §2).
  const required = ['evidenceId', 'workItemId', 'phase', 'gate', 'status', 'inputTreeHash', 'criteriaHash', 'relevantFiles', 'createdAt'];
  for (const field of required) {
    if (ev[field] === undefined || ev[field] === null) {
      errors.push({ path: field, message: `${field} is required` });
    }
  }
  // Required keys that may be explicitly null (e.g. manual-confirmation has no command).
  for (const field of ['command', 'result']) {
    if (!(field in ev)) errors.push({ path: field, message: `${field} is required (may be null)` });
  }
  // A freshness bound is mandatory: either an expiry or an explicit policy.
  // v3 (strict only, manual-confirmation only): a *non-null* bound.
  // An automated `passed` record is bound to files by `inputTreeHash`, so a
  // null expiry does not mean "never stale" for it. A manual-confirmation has
  // no such binding — its only freshness control is the expiry — so there,
  // `expiresAt: null` + `freshnessPolicy: null` is a real hole.
  const hasExpiry = ev.expiresAt !== undefined && ev.expiresAt !== null;
  const hasPolicy = ev.freshnessPolicy !== undefined && ev.freshnessPolicy !== null;
  if (ev.expiresAt === undefined && ev.freshnessPolicy === undefined) {
    errors.push({ path: 'expiresAt', message: 'evidence must declare expiresAt or freshnessPolicy' });
  } else if (strict && ev.status === 'manual-confirmation' && !hasExpiry && !hasPolicy) {
    errors.push({
      path: 'expiresAt',
      message: 'strictClosure requires a usable freshness bound: expiresAt and freshnessPolicy are both null, so the record never expires',
    });
  }
  if (ev.evidenceId !== undefined && !isUuid(ev.evidenceId)) errors.push({ path: 'evidenceId', message: 'evidenceId must be a UUIDv4' });
  if (ev.phase !== undefined && !PHASES.includes(ev.phase)) errors.push({ path: 'phase', message: `unknown phase "${ev.phase}"` });
  if (ev.gate !== undefined && !GATES.includes(ev.gate)) errors.push({ path: 'gate', message: `unknown gate "${ev.gate}"` });
  if (ev.status !== undefined && !EVIDENCE_STATUSES.includes(ev.status)) errors.push({ path: 'status', message: `unknown evidence status "${ev.status}"` });
  if (ev.relevantFiles !== undefined && !Array.isArray(ev.relevantFiles)) errors.push({ path: 'relevantFiles', message: 'relevantFiles must be an array' });
  if (ev.inputTreeHash !== undefined && !/^[0-9a-f]{64}$/.test(String(ev.inputTreeHash))) {
    errors.push({ path: 'inputTreeHash', message: 'inputTreeHash must be a SHA-256 hex digest' });
  }
  if (ev.criteriaHash !== undefined && ev.criteriaHash !== null && !/^[0-9a-f]{64}$/.test(String(ev.criteriaHash))) {
    errors.push({ path: 'criteriaHash', message: 'criteriaHash must be a SHA-256 hex digest' });
  }
  if (ev.command !== undefined && ev.command !== null && typeof ev.command !== 'string') {
    errors.push({ path: 'command', message: 'command must be a string or null' });
  }
  if (ev.result !== undefined && ev.result !== null && typeof ev.result !== 'string') {
    errors.push({ path: 'result', message: 'result must be a string or null' });
  }
  // AR-1. `commit` is optional (a v2-shaped record omits it) but must be a real
  // revision identifier when present — a branch or tag name would read as a
  // citation while being uncheckable later, which is worse than none.
  if (ev.commit !== undefined && ev.commit !== null && !/^[0-9a-fA-F]{4,40}$/.test(String(ev.commit))) {
    errors.push({
      path: 'commit',
      message: 'commit must be a 4-40 character hex revision identifier, or null',
    });
  }
  if (ev.createdAt !== undefined && ev.createdAt !== null && Number.isNaN(Date.parse(ev.createdAt))) {
    errors.push({ path: 'createdAt', message: 'createdAt must be an ISO-8601 date-time' });
  }
  if (ev.expiresAt !== undefined && ev.expiresAt !== null && Number.isNaN(Date.parse(ev.expiresAt))) {
    errors.push({ path: 'expiresAt', message: 'expiresAt must be an ISO-8601 date-time or null' });
  }
  if (ev.freshnessPolicy !== undefined && ev.freshnessPolicy !== null) {
    if (!isPlainObject(ev.freshnessPolicy)) {
      errors.push({ path: 'freshnessPolicy', message: 'freshnessPolicy must be an object or null' });
    } else if (!['story', 'phase', 'run', 'manual'].includes(ev.freshnessPolicy.scope)) {
      errors.push({ path: 'freshnessPolicy.scope', message: 'freshnessPolicy.scope must be story|phase|run|manual' });
    }
  }

  if (strict && ev.status === 'manual-confirmation') {
    errors.push(...validateManualConfirmation(ev, strict));
  }

  return errors;
}

/**
 * Strict-closure constraints on a manual-confirmation record (contract v3 §3).
 * Reports *every* problem at once so a caller fixes the record in one pass.
 */
function validateManualConfirmation(ev, strict) {
  const errors = [];
  const mc = strict.manualConfirmation || DEFAULT_STRICT_CLOSURE.manualConfirmation;

  if (mc.requireReason !== false && (typeof ev.reason !== 'string' || ev.reason.trim() === '')) {
    errors.push({ path: 'reason', message: 'strictClosure requires a non-empty "reason" explaining why automation was unavailable' });
  }

  if (mc.requireExpiresAt !== false) {
    if (typeof ev.expiresAt !== 'string' || Number.isNaN(Date.parse(ev.expiresAt))) {
      errors.push({ path: 'expiresAt', message: 'strictClosure requires a concrete "expiresAt" (a null validity bound is not accepted)' });
    } else if (mc.maxValidityMs !== null && mc.maxValidityMs !== undefined && ev.createdAt) {
      // A record whose createdAt lies in the future can shift both timestamps
      // forward and stay "valid" indefinitely: the window would look legal while
      // the assertion never expires. Reject future-dated records outright, with a
      // small tolerance for clock skew between the writer and the validator.
      const createdMs = Date.parse(ev.createdAt);
      if (Number.isFinite(createdMs)) {
        const skew = mc.clockSkewToleranceMs ?? DEFAULT_STRICT_CLOSURE.manualConfirmation.clockSkewToleranceMs;
        if (createdMs > Date.now() + skew) {
          errors.push({
            path: 'createdAt',
            message: `strictClosure rejects a future-dated "createdAt" (${ev.createdAt}); a record cannot be created in the future`,
          });
        }
      }
      const window = Date.parse(ev.expiresAt) - Date.parse(ev.createdAt);
      if (Number.isFinite(window) && window > mc.maxValidityMs) {
        errors.push({
          path: 'expiresAt',
          message: `strictClosure manual-confirmation validity (${window}ms) exceeds maxValidityMs (${mc.maxValidityMs}ms)`,
        });
      }
      // The window must also be measured against the present, so that a record
      // cannot be given an arbitrarily distant expiry by post-dating createdAt.
      const remaining = Date.parse(ev.expiresAt) - Date.now();
      if (Number.isFinite(remaining) && remaining > mc.maxValidityMs) {
        errors.push({
          path: 'expiresAt',
          message: `strictClosure manual-confirmation expiry is ${remaining}ms from now, beyond maxValidityMs (${mc.maxValidityMs}ms)`,
        });
      }
    }
  }

  if (mc.requireEnvironment !== false) {
    const env = ev.environment;
    if (!isPlainObject(env)) {
      errors.push({ path: 'environment', message: 'strictClosure requires an "environment" object describing what was verified' });
    } else if (!env.projectPath && !env.tool) {
      errors.push({ path: 'environment', message: 'strictClosure requires "environment.projectPath" or "environment.tool"' });
    }
  }

  if (mc.requireScope !== false) {
    const scope = ev.scope;
    if (!Array.isArray(scope) || scope.length === 0) {
      errors.push({ path: 'scope', message: 'strictClosure requires a non-empty "scope" array naming what the confirmation covers' });
    } else if (!scope.every((s) => typeof s === 'string' && s.trim() !== '')) {
      // The schema declares items as strings; code and schema must agree, or a
      // record validates here and then fails schema validation downstream.
      errors.push({ path: 'scope', message: 'strictClosure requires every "scope" entry to be a non-empty string' });
    }
  }

  if (Array.isArray(strict.disallowManualFor) && strict.disallowManualFor.includes(ev.gate)) {
    errors.push({
      path: 'status',
      message: `manual-confirmation is not permitted for gate "${ev.gate}" under strictClosure.disallowManualFor; record automated evidence instead`,
    });
  }

  return errors;
}

/**
 * Resume the resolved strict-closure policy from whatever the caller supplied.
 * Accepts a full resolved policy, a bare `strictClosure` block, or null.
 * Returns null when strict closure is not active, so callers can branch cheaply
 * and cannot accidentally apply half-strict behaviour.
 */
export function resolveStrict(context) {
  if (!context) return null;
  // Accept the shapes a caller may reasonably pass, so a resolved policy and a
  // bare strictClosure block are interchangeable:
  //   { strictClosure: { enabled, ... } }          — a resolved policy
  //   { enabled, manualConfirmation, ... }         — a bare strictClosure block
  //   { strictClosure: { strictClosure: {...} } }  — a resolved policy nested as a block
  const nested = context.strictClosure;
  const block = (nested && nested.strictClosure && nested.strictClosure.enabled !== undefined)
    ? nested.strictClosure
    : nested;
  if (!block || block.enabled !== true) return null;
  return {
    ...DEFAULT_STRICT_CLOSURE,
    ...block,
    manualConfirmation: { ...DEFAULT_STRICT_CLOSURE.manualConfirmation, ...(block.manualConfirmation || {}) },
    disallowManualFor: block.disallowManualFor || [...DEFAULT_STRICT_CLOSURE.disallowManualFor],
  };
}

/**
 * Strict-closure constraints on a `gate-exception` entry (contract v3 §4).
 *
 * The category is what makes an exception's expiry policy and review burden
 * derivable instead of arbitrary. An unknown category is rejected with the valid
 * set named, mirroring how unknown budget keys are handled: a typo must not
 * produce an exception that silently escapes its rules.
 */
function validateGateException(entry, strict) {
  const errors = [];
  if (!entry.gate || !GATES.includes(entry.gate)) {
    errors.push({ path: 'gate', message: `gate-exception has unknown gate "${entry.gate}"` });
  }
  const category = entry.category;
  if (!category) {
    errors.push({ path: 'category', message: `strictClosure requires a "category" on gate-exception. Valid categories: ${EXCEPTION_CATEGORIES.join(', ')}` });
    return errors;
  }
  if (!EXCEPTION_CATEGORIES.includes(category)) {
    errors.push({ path: 'category', message: `unknown exception category "${category}". Valid categories: ${EXCEPTION_CATEGORIES.join(', ')}` });
    return errors;
  }

  if (EXCEPTION_REQUIRES_REVIEW_NOTE.includes(category)) {
    if (typeof entry.closureReviewNote !== 'string' || entry.closureReviewNote.trim() === '') {
      errors.push({ path: 'closureReviewNote', message: `exception category "${category}" requires a "closureReviewNote" recording who accepted it and what would change that judgement` });
    }
  }

  // Category-derived expiry: a category default can be shortened freely, but
  // extending it is a deliberate act that must be explained.
  const defaultDays = EXCEPTION_EXPIRY_DAYS[category];
  if (defaultDays !== null && defaultDays !== undefined) {
    if (entry.expiresAt === undefined || entry.expiresAt === null) {
      errors.push({ path: 'expiresAt', message: `exception category "${category}" requires an "expiresAt" (default window is ${defaultDays} day(s))` });
    } else {
      const maxMs = defaultDays * 24 * 60 * 60 * 1000;
      const created = entry.createdAt ? Date.parse(entry.createdAt) : Date.now();
      const expiry = Date.parse(entry.expiresAt);
      if (Number.isFinite(expiry) && Number.isFinite(created) && expiry - created > maxMs) {
        if (typeof entry.expiryExtendedReason !== 'string' || entry.expiryExtendedReason.trim() === '') {
          errors.push({
            path: 'expiryExtendedReason',
            message: `exception category "${category}" expires beyond its ${defaultDays}-day default; state an "expiryExtendedReason" to extend it`,
          });
        }
      }
    }
  }
  return errors;
}

// ── Migration ───────────────────────────────────────────────────────────────

/**
 * Migrate a v1 state document to the current version in memory. Unknown
 * top-level fields are preserved. Does not touch the filesystem.
 *
 * A v2/v3/v4 document is returned *unchanged*. That is deliberate and is pinned
 * by tests: a read must not silently rewrite a document to a new version, because
 * the version stamp decides which semantics apply and a bump would otherwise
 * change how existing evidence is judged. Moving a v2/v3 document to v4 is an
 * explicit act — `state migrate --to 4` — not a side effect of reading it.
 */
export function migrateStateV1toV2(v1) {
  if (!isPlainObject(v1)) throw new StateError('cannot migrate a non-object state');
  const declared = v1.version ?? v1.stateVersion;
  if (typeof declared === 'number' && declared >= 2 && READABLE_STATE_VERSIONS.includes(declared)) {
    return { state: { ...v1, gateEvidence: v1.gateEvidence || [] }, changed: false };
  }
  const gates = isPlainObject(v1.gates) ? { ...v1.gates } : {};
  for (const gate of GATES) {
    if (typeof gates[gate] !== 'boolean') gates[gate] = false;
  }
  // Preserve any unknown top-level fields that are safe to keep.
  const preserved = {};
  for (const [key, value] of Object.entries(v1)) {
    if (!['version', 'session', 'epics', 'gates', 'spikes', 'changeHistory'].includes(key)) {
      preserved[key] = value;
    }
  }
  // v1 migrates straight to the current version. The intermediate shapes are
  // identical for these fields; only the version stamp differs, so a single-step
  // migration avoids a transient on-disk document at a version nobody asked for.
  // `toStateV4` then applies the current shape, which for a v1 document means
  // promoting any gate exceptions out of `changeHistory` (v1 had no evidence
  // array to compact) and installing an empty coverage index.
  const migrated = {
    ...preserved,
    version: STATE_VERSION,
    stateVersion: STATE_VERSION,
    session: { ...v1.session },
    epics: v1.epics || {},
    gates,
    gateEvidence: [],
    activeRunId: null,
    activeWorkItem: activeWorkItemFromState(v1),
    lastTransition: null,
    spikes: v1.spikes || {},
    changeHistory: Array.isArray(v1.changeHistory) ? [...v1.changeHistory] : [],
  };
  const { state } = toStateV4(migrated);
  return { state, changed: true };
}

/**
 * How many `changeHistory` entries stay inline after compaction.
 *
 * `changeHistory` is *not* retired in v4, and this constant is why. Eight skills
 * instruct the agent to record an artifact path there ("record the requirements
 * document path in `changeHistory`"), and `Resume` cross-checks its last entry
 * against commit history. Removing the field would make those instructions wrong
 * and take away a facility with no replacement. What was actually unbounded was
 * not the field — it was its *contents*: on the audited repository 65% of the log
 * was 116 handoff entries averaging 1.9 KB of prose each, every one of them
 * duplicating a file already written to `.cadet/handoffs/`, plus 162 one-line
 * transition records already covered by `lastTransition`.
 */
export const HISTORY_ENTRIES_KEPT = 25;

/**
 * Split a change log into the tail that stays inline and the overflow to archive.
 *
 * Keeps the most recent entries, because that is what `Resume` reads and what a
 * handoff cross-checks against. The overflow is returned rather than discarded so
 * the caller can persist it: an audit trail may move, but it must not evaporate.
 */
export function compactHistory(entries, { keepRecent = HISTORY_ENTRIES_KEPT } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length <= keepRecent) return { kept: list, archived: [] };
  return {
    kept: list.slice(list.length - keepRecent),
    archived: list.slice(0, list.length - keepRecent),
  };
}

/**
 * Reshape a document into v4 (contract v5): keep only the active work item's
 * evidence inline, move the rest to `archived` for the caller to persist, promote
 * gate exceptions into their own field, bound the change log, and install the
 * coverage index.
 *
 * Pure — it returns the records to archive rather than writing them, so the
 * caller owns the archive location and this stays testable without a filesystem.
 */
export function toStateV4(state, { keep = 'active', keepHistory = HISTORY_ENTRIES_KEPT } = {}) {
  const { live, archived, coverage } = splitEvidence(state, { keep });

  const promoted = [];
  const remainingHistory = [];
  for (const entry of Array.isArray(state.changeHistory) ? state.changeHistory : []) {
    // Exceptions are live state, so they are kept — a legacy one still in
    // changeHistory is promoted rather than dropped, since dropping it would
    // silently withdraw an exception that a gate currently depends on.
    if (entry?.type === 'gate-exception') promoted.push({ ...entry });
    else remainingHistory.push(entry);
  }
  const { kept: history, archived: archivedHistory } = compactHistory(remainingHistory, { keepRecent: keepHistory });

  const next = {
    ...state,
    version: STATE_VERSION,
    stateVersion: STATE_VERSION,
    gateEvidence: live,
    evidenceCoverage: coverage,
    gateExceptions: [
      ...promoted,
      ...(Array.isArray(state.gateExceptions) ? state.gateExceptions : []),
    ],
    changeHistory: history,
  };

  return {
    state: next,
    archived,
    archivedHistory,
    live: live.length,
    promoted: promoted.length,
    droppedHistory: archivedHistory.length,
  };
}

/**
 * Parse a `--to` value: accepts `4`, `"4"`, and `"v4"`. Returns `null` when
 * absent, and `NaN` when present but unusable so the caller can reject loudly
 * instead of silently migrating to a default.
 */
export function parseTargetVersion(to) {
  if (to === null || to === undefined || to === '') return null;
  const text = String(to).trim().replace(/^v/i, '');
  if (!/^\d+$/.test(text)) return NaN;
  const n = Number(text);
  return READABLE_STATE_VERSIONS.includes(n) ? n : NaN;
}

/**
 * Apply a migration to a document in memory, at the requested target.
 *
 * The rule is "never downgrade, never guess": a v1 document always migrates
 * forward (that is the documented v1 path), a document only changes when the
 * caller explicitly asked for a higher version, and a request at or below the
 * current version is a no-op rather than an error, so a retried migration is safe.
 */
export function migrateStateDocument(raw, { to = null, keep = 'active', keepHistory = HISTORY_ENTRIES_KEPT } = {}) {
  const target = parseTargetVersion(to);
  if (Number.isNaN(target)) {
    throw new StateError(`invalid --to version ${JSON.stringify(to)}; expected one of ${READABLE_STATE_VERSIONS.join(', ')}`);
  }
  const from = raw?.version ?? raw?.stateVersion;
  if (from === 1) {
    const { state, changed } = migrateStateV1toV2(raw);
    return { state, changed, archived: [], archivedHistory: [], promoted: 0, droppedHistory: 0 };
  }
  if (typeof from !== 'number' || !READABLE_STATE_VERSIONS.includes(from)) {
    throw new StateError(`cannot migrate unsupported state version ${JSON.stringify(from)}`);
  }
  if (target !== null && from < target) {
    const r = toStateV4(raw, { keep, keepHistory });
    return {
      state: r.state,
      changed: true,
      archived: r.archived,
      archivedHistory: r.archivedHistory,
      promoted: r.promoted,
      droppedHistory: r.droppedHistory,
    };
  }
  return { state: raw, changed: false, archived: [], archivedHistory: [], promoted: 0, droppedHistory: 0 };
}

/**
 * Migrate a state file on disk atomically: write a temporary file, optionally
 * back up the original, then rename into place. A failed migration leaves the
 * original untouched.
 *
 * `archived` records are returned rather than written here: the caller decides
 * where the append-only archive lives, and keeping this function's failure
 * contract simple ("nothing is written") is what the `atomicFailure` guarantee in
 * the command registry depends on.
 */
export function migrateStateFile(statePath, { backup = true, to = null, keep = 'active', keepHistory = HISTORY_ENTRIES_KEPT, beforeWrite = null } = {}) {
  if (!existsSync(statePath)) {
    throw new StateError(`state file not found: ${statePath}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch (err) {
    throw new StateError(`cannot migrate malformed state: ${err.message}`);
  }
  const { state, changed, archived, archivedHistory, promoted, droppedHistory } = migrateStateDocument(raw, { to, keep, keepHistory });
  if (!changed) return { migrated: false, statePath, state, archived: [], archivedHistory: [], promoted: 0, droppedHistory: 0 };

  const from = raw.version ?? raw.stateVersion;
  const backupPath = `${statePath}.v${from}.bak`;
  const dir = dirname(statePath);
  const tmpDir = mkdtempSync(join(tmpdir(), 'cadet-state-'));
  const tmpPath = join(tmpDir, 'state.json');
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    // Validate BEFORE writing anything to the real tree. The backup is an
    // artifact of a *successful* migration, so producing one and then failing
    // would leave a write the caller never got and did not ask for — a failed
    // `migrate` must leave the directory exactly as it found it. Checking first
    // also means a bad migration cannot overwrite a previous good backup.
    //
    // This is a structural-only check: a freshly migrated state has no on-disk
    // evidence to bind, so freshness is intentionally not evaluated here.
    const check = validateState(state, { structuralOnly: true });
    if (!check.valid) {
      throw new StateError(`migrated state failed validation: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }
    // Persist the archive BEFORE the document that no longer references it.
    //
    // This ordering is the whole safety argument for compaction. The records
    // filtered out of `gateEvidence` exist nowhere else, so writing the slimmer
    // document first and the archive second would lose them outright if the
    // process died in between. Written first, a crash leaves records present in
    // *both* places — recoverable and detectable, which is the direction a
    // failure should point. A throw here happens before the backup is copied and
    // before the rename, so `atomicFailure` still holds: the tree is untouched.
    if (beforeWrite) beforeWrite({ archived, archivedHistory, state, from });
    if (backup) {
      copyFileSync(statePath, backupPath);
    }
    // A failed rename leaves the original in place.
    renameSync(tmpPath, statePath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return { migrated: true, statePath, state, archived, archivedHistory, promoted, droppedHistory, backupPath };
}

/**
 * The trailer lines that seal a work item's evidence into a commit, plus the
 * records they carry (contract v5).
 *
 * Selection is by work item, never by status: `sealWorkItem` is the counterpart of
 * `splitEvidence` and must produce exactly the records that compaction left
 * inline, or the archive and the commit would disagree about what was sealed.
 */
export function sealWorkItem(state, { workItemId = null, maxBytes = undefined } = {}) {
  const id = workItemId || (state?.activeWorkItem ? workItemIdOf(state) : null);
  const records = (Array.isArray(state?.gateEvidence) ? state.gateEvidence : [])
    .filter((r) => !id || r?.workItemId === id);
  const lines = [];
  const partial = [];
  for (const record of records) {
    const encoded = encodeEvidenceTrailers(record, maxBytes === undefined ? {} : { maxBytes });
    lines.push(...encoded.lines, '');
    if (encoded.partial) partial.push(record.evidenceId || '(no id)');
  }
  return { workItemId: id, records, lines, partial };
}

function activeWorkItemFromState(state) {
  const epics = state.epics;
  if (!isPlainObject(epics)) return null;
  for (const [epicId, epic] of Object.entries(epics)) {
    if (!isPlainObject(epic) || !isPlainObject(epic.stories)) continue;
    for (const [storyId, status] of Object.entries(epic.stories)) {
      if (status === 'in-progress') return { epicId, storyId };
    }
  }
  return null;
}

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * AR-1. Normalize and validate a commit citation.
 *
 * Accepts a full SHA or an abbreviated one (git's default short form is 7, but
 * 4–40 hex characters are all unambiguous enough to store). A symbolic name such
 * as a branch or tag is REJECTED: those move, so a record naming one cannot be
 * checked later, which defeats the purpose of citing a revision at all.
 *
 * Returns null for an absent value so a v2-shaped record is unchanged.
 */
export function normalizeCommit(commit) {
  if (commit === null || commit === undefined) return null;
  const value = String(commit).trim();
  if (value === '') return null;
  if (!/^[0-9a-fA-F]{4,40}$/.test(value)) {
    throw new StateError(
      `commit must be a 4-40 character hex revision identifier, but was "${value}". `
      + 'A branch or tag name is not accepted: it moves, so the citation could not be '
      + 'checked later. Pass an abbreviated or full SHA.',
    );
  }
  return value.toLowerCase();
}

/** Build an evidence record. `id` defaults to a fresh UUIDv4. */
export function createEvidence({
  evidenceId,
  workItemId,
  acceptanceCriterionId = null,
  phase,
  gate,
  status,
  command = null,
  result = null,
  exitCode = null,
  artifactPath = null,
  artifactHash = null,
  inputTreeHash,
  criteriaHash = null,
  relevantFiles = [],
  toolVersion = null,
  commit = null,
  createdAt = new Date(),
  expiresAt = null,
  freshnessPolicy = null,
  source = 'automated',
  id,
}) {
  // AR-1. A gate record must be able to name the revision it attests, or a
  // "gate-related fix claim" cannot be traced to the code it claims to cover.
  // Validated rather than trusted: this value is persisted into state.json and
  // read back by the Reviewer, so a malformed one would make a claim look
  // verified while naming nothing.
  const normalizedCommit = normalizeCommit(commit);
  return {
    evidenceId: evidenceId || id || undefined,
    workItemId,
    acceptanceCriterionId,
    phase,
    gate,
    status,
    command,
    result,
    exitCode,
    artifactPath,
    artifactHash,
    inputTreeHash,
    criteriaHash: criteriaHash || hashCriteria([]),
    relevantFiles,
    toolVersion,
    commit: normalizedCommit,
    createdAt: timestamp(createdAt),
    expiresAt: expiresAt ? timestamp(expiresAt) : null,
    freshnessPolicy,
    supersededBy: null,
    source,
  };
}

/**
 * Build the input tree hash for a set of relevant files resolved against a root.
 * Missing files are recorded as `missing` so their absence is detectable.
 */
export function computeInputTreeHash(rootDir, relativePaths) {
  const pairs = relativePaths.map((p) => ({ path: p, hash: hashFile(join(rootDir, p)) }));
  return hashTree(pairs);
}

/** A work item identifier string used to bind evidence to the active story. */
export function workItemIdOf(state) {
  const item = state?.activeWorkItem;
  if (!item) return 'unscoped';
  return `${item.epicId || 'none'}::${item.storyId || 'none'}`;
}

/**
 * Is an evidence record usable for a gate at this point in time?
 * Returns `{ fresh, reasons }`.
 */
export function evidenceFreshness(evidence, context) {
  const reasons = [];
  const {
    now = new Date(),
    workItemId = null,
    phase = null,
    inputTreeHash = null,
    criteriaHash = null,
  } = context || {};

  if (evidence.status === 'superseded') reasons.push('evidence was superseded');
  if (evidence.status !== 'passed' && evidence.status !== 'manual-confirmation') {
    if (evidence.status !== 'superseded') reasons.push(`evidence status is "${evidence.status}", not passing`);
  }
  if (workItemId && evidence.workItemId !== workItemId) {
    reasons.push(`evidence belongs to work item "${evidence.workItemId}", not "${workItemId}"`);
  }
  if (inputTreeHash && evidence.inputTreeHash !== inputTreeHash) {
    reasons.push('input tree hash changed since the evidence was recorded');
  }
  if (criteriaHash && evidence.criteriaHash && evidence.criteriaHash !== criteriaHash) {
    reasons.push('acceptance criteria changed since the evidence was recorded');
  }
  if (evidence.expiresAt && new Date(evidence.expiresAt).getTime() <= now.getTime()) {
    reasons.push('evidence expired');
  }
  if (phase && evidence.phase !== phase) {
    const allowed = evidence.freshnessPolicy?.allowPhases || [];
    if (!allowed.includes(phase)) {
      reasons.push(`evidence was recorded for phase "${evidence.phase}", not "${phase}"`);
    }
  }
  return { fresh: reasons.length === 0, reasons };
}

/** The most recent evidence for a gate, or null. */
export function latestEvidenceForGate(state, gate) {
  const list = Array.isArray(state?.gateEvidence) ? state.gateEvidence : [];
  const matching = list.filter((e) => e.gate === gate);
  if (matching.length === 0) return null;
  return matching.reduce((a, b) => (new Date(a.createdAt) >= new Date(b.createdAt) ? a : b));
}

/**
 * Append an evidence record without touching gates or superseding anything.
 *
 * The primitive every evidence writer shares. It exists so the coverage index has
 * exactly one place to be maintained: an index that only some append paths updated
 * would report coverage for whichever gates happened to travel through the
 * maintained path, which is worse than no index because it looks authoritative.
 */
export function appendEvidence(state, evidence) {
  const next = {
    ...state,
    gateEvidence: [...(Array.isArray(state?.gateEvidence) ? state.gateEvidence : []), evidence],
  };
  if (isHistoryExternal(state)) {
    next.evidenceCoverage = mergeEvidenceCoverage(
      isPlainObject(state?.evidenceCoverage) ? state.evidenceCoverage : {},
      [evidence],
    );
  }
  return next;
}

/**
 * Append an evidence record to a document and flip its gate.
 *
 * Supersedes prior passing evidence for the same gate rather than overwriting it,
 * because evidence is immutable: a correction is a new record that names the one it
 * replaces. Built on `appendEvidence` so the index and the array stay in step.
 *
 * Centralised so `harness confirm`, `harness verify`, `harness verify-acs` and the
 * tests cannot drift.
 */
export function recordEvidence(state, evidence) {
  const gate = evidence?.gate;
  const superseding = { ...state };
  if (gate) {
    superseding.gateEvidence = (Array.isArray(state?.gateEvidence) ? state.gateEvidence : [])
      .map((e) => (e?.gate === gate && (e.status === 'passed' || e.status === 'manual-confirmation')
        ? { ...e, status: 'superseded', supersededBy: evidence.evidenceId }
        : e));
  }
  const next = appendEvidence(superseding, evidence);
  if (gate) next.gates = { ...(state.gates || {}), [gate]: true };
  return next;
}

/**
 * Active gate exceptions keyed by gate, honoring scope and expiry.
 *
 * Reads both homes for an exception: `changeHistory` (v1-v3, where a `type`
 * discriminator picks it out of the log) and `gateExceptions` (v4, a dedicated
 * field where the discriminator would be redundant). Later entries win, so a
 * v4 document that still carries legacy entries behaves as it did before.
 */
export function activeExceptions(state, { workItemId, now = new Date() } = {}) {
  const candidates = [
    ...(Array.isArray(state?.changeHistory) ? state.changeHistory.filter((e) => e?.type === 'gate-exception') : []),
    ...(Array.isArray(state?.gateExceptions) ? state.gateExceptions : []),
  ];
  const active = {};
  for (const entry of candidates) {
    if (!isPlainObject(entry)) continue;
    if (workItemId && entry.scope && !String(entry.scope).includes(workItemId)) continue;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now.getTime()) continue;
    if (entry.gate) active[entry.gate] = entry;
  }
  return active;
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** Required gates for a transition target, or null when the target is not gated. */
export function requiredGates(toPhase) {
  for (const [from, spec] of Object.entries(TRANSITIONS)) {
    if (spec.to === toPhase) return { from, gates: spec.gates, revalidate: spec.revalidate || [] };
  }
  return null;
}

/**
 * Ungated forward edges — transitions that carry no gate requirement but are
 * still legal. These are the bootstrap and planning-progression edges from the
 * workflow (README mermaid + Workflow.md): classification can drop straight to
 * implementation, and the planning phases advance without gates.
 *
 * This list exists because `requiredGates` returns null for any phase that is
 * never a *target* of a gated transition (implementation, requirements,
 * architecture, …). Treating null as "ungated, therefore legal" allowed a
 * transition into those phases from ANYWHERE — including out of the terminal
 * `closed` phase. The set below is the closed enumeration of the intended
 * forward edges; anything not in it (or in TRANSITIONS) is rejected.
 */
const UNGATED_FORWARD_EDGES = Object.freeze([
  // Classification (context-resolution) routes to planning or straight to work.
  ['context-resolution', 'requirements'],
  ['context-resolution', 'architecture'],
  ['context-resolution', 'implementation'],
  // Planning progression.
  ['requirements', 'architecture'],
  ['requirements', 'requirementsComplete'],
  ['requirementsComplete', 'architecture'],
  ['requirementsComplete', 'architectureComplete'],
  ['architecture', 'architectureComplete'],
  ['architecture', 'spikes'],
  ['requirements', 'spikes'],
  ['requirementsComplete', 'spikes'],
  ['architectureComplete', 'spikes'],
  ['spikes', 'architecture'],
  ['spikes', 'architectureComplete'],
  ['architectureComplete', 'story-breakdown'],
  ['spikes', 'story-breakdown'],
  ['story-breakdown', 'implementation'],
  // Next-story loop. The workflow is
  //   VALIDATE -->|"gate: designArtifactSyncConfirmed"| NEXT_STORY
  //   NEXT_STORY -->|"yes"| IMPL
  //   NEXT_STORY -->|"no"| CLOSED
  // so the next story in an epic re-enters implementation from `validation`.
  // `closed` stays terminal — it means the epic/plan is finished
  // (Resume: "All work is complete for the current epic(s)") — and is
  // deliberately NOT an escape hatch for starting the next story.
  ['validation', 'implementation'],
]);

/** Is `from → to` one of the declared ungated forward edges? */
export function isUngatedForwardEdge(fromPhase, toPhase) {
  return UNGATED_FORWARD_EDGES.some(([from, to]) => from === fromPhase && to === toPhase);
}

/**
 * Check one gate for a transition. Shared by the primary `gates` set and the
 * strict-closure `revalidate` set so the two can never drift apart.
 *
 * `recencyFloor` implements `requireFreshRevalidation`: when supplied, evidence
 * must have been created at or after that instant. Without it, "fresh" would mean
 * only "not yet expired", which lets a long phase carry evidence that predates
 * the work it is meant to attest.
 */
function checkGate({ gate, state, gates, exceptions, now, workItemId, fromPhase, rootDir, computeTreeHash, inputTreeHash, critHash, recencyFloor = null }) {
  const missingGates = [];
  const staleEvidence = [];

  if (gates[gate] !== true) {
    if (exceptions[gate]) return { missingGates, staleEvidence };
    missingGates.push(gate);
    return { missingGates, staleEvidence };
  }

  const evidence = latestEvidenceForGate(state, gate);
  if (!evidence) {
    if (exceptions[gate]) return { missingGates, staleEvidence };
    missingGates.push(gate);
    staleEvidence.push({ gate, reason: 'no evidence record for a claimed-true gate' });
    return { missingGates, staleEvidence };
  }

  let currentTreeHash = inputTreeHash;
  if (computeTreeHash) {
    const relevant = Array.isArray(evidence.relevantFiles) ? evidence.relevantFiles : [];
    currentTreeHash = computeInputTreeHash(rootDir, relevant);
  }
  const { fresh, reasons } = evidenceFreshness(evidence, {
    now,
    workItemId,
    phase: fromPhase,
    inputTreeHash: currentTreeHash,
    criteriaHash: critHash,
  });

  const allReasons = [...reasons];
  let stillFresh = fresh;
  if (recencyFloor && evidence.createdAt) {
    const created = Date.parse(evidence.createdAt);
    if (Number.isFinite(created) && created < recencyFloor.getTime()) {
      stillFresh = false;
      allReasons.push('evidence predates the last transition, so it does not confirm the gate is still true now');
    }
  }

  if (!stillFresh && !exceptions[gate]) {
    missingGates.push(gate);
    staleEvidence.push({ gate, evidenceId: evidence.evidenceId, reasons: allReasons });
  }
  return { missingGates, staleEvidence };
}

/**
 * Evaluate whether a transition is legal and evidence-backed.
 * Returns a machine-readable result:
 * `{ allowed, toPhase, missingGates, staleEvidence, errors, revalidated }`.
 *
 * Strict closure (contract v3 §1) additionally re-checks the `revalidate` set for
 * the target transition when `context.strictClosure.enabled` is true. With the
 * flag off, only `gates` is checked and behaviour matches v2 exactly.
 */
export function evaluateTransition(state, toPhase, context = {}) {
  const errors = [];
  const missingGates = [];
  const staleEvidence = [];
  const fromPhase = state?.session?.currentPhase;
  const workItemId = context.workItemId || workItemIdOf(state);
  const now = context.now || new Date();

  if (!PHASES.includes(toPhase)) {
    errors.push(`unknown target phase "${toPhase}"`);
    return { allowed: false, fromPhase, toPhase, missingGates, staleEvidence, errors, revalidated: [] };
  }
  if (toPhase === fromPhase) {
    errors.push(`already in phase "${toPhase}"`);
    return { allowed: false, fromPhase, toPhase, missingGates, staleEvidence, errors, revalidated: [] };
  }

  const spec = requiredGates(toPhase);
  if (!spec) {
    // Ungated transitions are legal ONLY along the declared forward edges
    // (bootstrap + planning progression). A target that is neither gated nor a
    // declared forward edge is rejected — most importantly, this makes `closed`
    // terminal instead of an any-to-any escape hatch.
    if (isUngatedForwardEdge(fromPhase, toPhase)) {
      return { allowed: true, fromPhase, toPhase, missingGates, staleEvidence, errors, revalidated: [] };
    }
    errors.push(`illegal transition "${fromPhase}" → "${toPhase}" (not a gated transition, and not a declared forward edge)`);
    return { allowed: false, fromPhase, toPhase, missingGates, staleEvidence, errors, revalidated: [] };
  }
  if (spec.from !== fromPhase) {
    errors.push(`illegal transition "${fromPhase}" → "${toPhase}" (expected from "${spec.from}")`);
    return { allowed: false, fromPhase, toPhase, missingGates: [...spec.gates], staleEvidence, errors, revalidated: [] };
  }

  const exceptions = activeExceptions(state, { workItemId, now });
  const gates = isPlainObject(state.gates) ? state.gates : {};
  // Freshness is enforced by default: unless the caller explicitly supplies a
  // hash, compute the current input-tree hash from each evidence record's own
  // relevant files. This prevents a caller from silently accepting stale evidence.
  const rootDir = context.rootDir || process.cwd();
  const computeTreeHash = context.inputTreeHash === undefined && context.computeFreshness !== false;
  const inputTreeHash = context.inputTreeHash !== undefined ? context.inputTreeHash : null;
  const critHash = context.criteriaHash !== undefined ? context.criteriaHash : null;

  const shared = { state, gates, exceptions, now, workItemId, fromPhase, rootDir, computeTreeHash, inputTreeHash, critHash };

  for (const gate of spec.gates) {
    const r = checkGate({ ...shared, gate });
    missingGates.push(...r.missingGates);
    staleEvidence.push(...r.staleEvidence);
  }

  // Strict closure: re-derive the earlier gates at this transition.
  const strict = resolveStrict(context);
  const revalidated = [];
  if (strict && strict.revalidateOnClosure !== false) {
    const recencyFloor = strict.requireFreshRevalidation !== false && state?.lastTransition?.at
      ? new Date(state.lastTransition.at)
      : null;
    for (const gate of spec.revalidate) {
      if (spec.gates.includes(gate)) continue; // already checked as a primary gate
      revalidated.push(gate);
      const r = checkGate({ ...shared, gate, recencyFloor });
      missingGates.push(...r.missingGates);
      staleEvidence.push(...r.staleEvidence);
    }
  }

  return {
    allowed: missingGates.length === 0 && errors.length === 0,
    fromPhase,
    toPhase,
    missingGates,
    staleEvidence,
    errors,
    revalidated,
    exceptions: Object.keys(exceptions),
  };
}

/**
 * Apply a legal transition to a state object (returns a new object).
 * Resets the target transition's gates is NOT done here — gates reset when a new
 * work item starts (see `resetGatesForNewWorkItem`).
 */
export function applyTransition(state, toPhase, { evidenceIds = [], at = new Date(), inputTreeHash = undefined, criteriaHash = undefined, rootDir = undefined, strictClosure = undefined } = {}) {
  const context = { now: at };
  if (inputTreeHash !== undefined) context.inputTreeHash = inputTreeHash;
  if (criteriaHash !== undefined) context.criteriaHash = criteriaHash;
  if (rootDir !== undefined) context.rootDir = rootDir;
  if (strictClosure !== undefined) context.strictClosure = strictClosure;
  const evaluation = evaluateTransition(state, toPhase, context);
  if (!evaluation.allowed) {
    throw new StateError(
      `illegal transition to "${toPhase}": ${[...evaluation.errors, ...evaluation.missingGates.map((g) => `missing gate ${g}`)].join('; ')}`,
      { evaluation }
    );
  }
  const next = {
    ...state,
    version: STATE_VERSION,
    stateVersion: STATE_VERSION,
    session: { ...state.session, currentPhase: toPhase },
    lastTransition: {
      from: state.session.currentPhase,
      to: toPhase,
      at: timestamp(at),
      evidenceIds,
    },
  };
  // v1-v3 documents record each transition as a prose line in `changeHistory`,
  // which is how those versions were specified. A v4 document does not: the
  // transition is already in `lastTransition`, and the commit that seals the work
  // item carries the rest. Appending a line per transition was one of the two
  // growth paths this version exists to close, along with the evidence array.
  if (!isHistoryExternal(state)) {
    next.changeHistory = [
      ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
      { date: timestamp(at), change: `Phase transition ${state.session.currentPhase} → ${toPhase}`, phase: toPhase },
    ];
  }
  return next;
}

/**
 * Recompute coverage rows from a record set.
 *
 * Rows for work items present in `records` are *replaced*, rows for items absent
 * are preserved. That split matters: compaction is by work item, so an item is
 * either archived (absent here, preserved from the prior index) or inline
 * (present here, authoritative) — never both. Recomputing rather than adding is
 * what makes this idempotent, so running it twice over the same document does not
 * report a story as doubly covered.
 */
export function buildEvidenceCoverage(records, existing = {}) {
  const coverage = { ...existing };
  const fresh = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = record?.workItemId;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!fresh.has(id)) {
      fresh.set(id, { workItemId: id, recordCount: 0, gates: [], firstAt: null, lastAt: null, sealedCommit: null });
    }
    const row = fresh.get(id);
    row.recordCount += 1;
    if (record.gate && !row.gates.includes(record.gate)) row.gates.push(record.gate);
    const at = record.createdAt ? Date.parse(record.createdAt) : NaN;
    if (Number.isFinite(at)) {
      if (!row.firstAt || at < Date.parse(row.firstAt)) row.firstAt = record.createdAt;
      if (!row.lastAt || at >= Date.parse(row.lastAt)) row.lastAt = record.createdAt;
    }
  }
  for (const [id, row] of fresh) {
    coverage[id] = {
      ...row,
      gates: row.gates.slice().sort(),
      // A seal recorded earlier survives a recompute; it is a fact about git
      // history, not something derivable from the records in hand.
      sealedCommit: coverage[id]?.sealedCommit ?? null,
    };
  }
  return coverage;
}

/**
 * Fold newly-recorded evidence into an existing index.
 *
 * Incremental by design, and deliberately distinct from `buildEvidenceCoverage`:
 * the records here are additions the index has never seen, so their counts must
 * be added to what is already known, not substituted for it. Conflating the two
 * operations is how a rebuilt index silently doubles every count.
 */
export function mergeEvidenceCoverage(existing, records) {
  const coverage = { ...(existing || {}) };
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const id = record.workItemId;
    if (typeof id !== 'string' || id.length === 0) continue;
    const row = coverage[id] || { workItemId: id, recordCount: 0, gates: [], firstAt: null, lastAt: null, sealedCommit: null };
    row.recordCount = (row.recordCount || 0) + 1;
    const gates = Array.isArray(row.gates) ? row.gates : [];
    if (record.gate && !gates.includes(record.gate)) gates.push(record.gate);
    row.gates = gates.slice().sort();
    const at = record.createdAt ? Date.parse(record.createdAt) : NaN;
    if (Number.isFinite(at)) {
      if (!row.firstAt || at < Date.parse(row.firstAt)) row.firstAt = record.createdAt;
      if (!row.lastAt || at >= Date.parse(row.lastAt)) row.lastAt = record.createdAt;
    }
    coverage[id] = row;
  }
  return coverage;
}

/**
 * Resolve a `keep` selector into a predicate over an evidence record.
 *
 * `active` (the default) keeps the active work item's records. That choice is not
 * merely conservative — it is provably safe for any document that was valid before
 * compaction: `validateState` already rejects a claimed-true gate whose supporting
 * record belongs to a *different* work item, so every gate a valid document
 * depends on is already backed by exactly the records this keeps. A stricter
 * selector (say, "newest passing record per gate") would be smaller and would
 * silently break the red-before-green rule, which needs the prior failing record
 * for the same work item and gate to still exist.
 */
function keepSelector(keep, state) {
  if (keep === 'always') return () => true;
  if (Array.isArray(keep)) {
    const wanted = new Set(keep.map((id) => String(id)));
    return (record) => wanted.has(String(record?.workItemId));
  }
  if (keep === null || keep === undefined || keep === 'active') {
    const activeId = state?.activeWorkItem ? workItemIdOf(state) : null;
    // With no active work item there is nothing to scope to. Keeping everything
    // would silently defeat the purpose, so nothing is kept — and a document in
    // that state with a claimed-true gate was already invalid, because the gate
    // check needs an active work item to bind against.
    return (record) => Boolean(activeId) && record?.workItemId === activeId;
  }
  throw new StateError(`unknown keep selector ${JSON.stringify(keep)}; expected "always", "active", or a list of work item ids`);
}

/**
 * Split a document's evidence into the part that stays live and the part that
 * becomes history (contract v5).
 *
 * "Live" is defined by a keep selector, defaulting to the active work item — see
 * `keepSelector` for why that boundary is the safe one.
 *
 * Returns `{ live, archived, coverage }`. Pure: no I/O, so the caller decides
 * where the archive is written.
 */
export function splitEvidence(state, { keep = 'active' } = {}) {
  const records = Array.isArray(state?.gateEvidence) ? state.gateEvidence : [];
  const keepRecord = keepSelector(keep, state);
  const live = [];
  const archived = [];
  for (const record of records) {
    if (keepRecord(record)) live.push(record);
    else archived.push(record);
  }
  const prior = isPlainObject(state?.evidenceCoverage) ? state.evidenceCoverage : {};
  const coverage = buildEvidenceCoverage(records, prior);
  return { live, archived, coverage };
}

/** Reset all gates to false for a new work item (atomic in the returned copy). */
export function resetGatesForNewWorkItem(state, { epicId = null, storyId = null, at = new Date() } = {}) {
  const gates = {};
  for (const gate of GATES) gates[gate] = false;
  const base = {
    ...state,
    gates,
    // The previous work item's evidence never belongs to the new one, so it is
    // cleared here in every version. What differs is whether anything is kept
    // behind to remember that it existed.
    gateEvidence: [],
    activeWorkItem: { epicId, storyId },
  };

  if (isHistoryExternal(state)) {
    // Fold the cleared records into the coverage index before they go.
    //
    // This is the whole point. `validateState` rejects a `done` story with no
    // evidence — and the reason that check exists is that it was once possible to
    // clear a story's gate state and have validation report the document clean,
    // with the gap invisible. Clearing an array that nothing summarised is exactly
    // how that happened, so the summary is written at the moment of clearing.
    const { coverage } = splitEvidence(state);
    base.evidenceCoverage = coverage;
    // An expired exception is inert by definition — `activeExceptions` already
    // ignores it — so dropping it cannot change a verdict. Keeping it would add a
    // row per exception forever to the document whose entire purpose is to stay
    // small.
    base.gateExceptions = (Array.isArray(state.gateExceptions) ? state.gateExceptions : [])
      .filter((entry) => !entry?.expiresAt || Date.parse(entry.expiresAt) > at.getTime());
    // A reset is still worth one line: `lastTransition` does not record it, and
    // `Resume` reads the log's tail. It is bounded by the number of stories and
    // carries no prose, so it costs nothing — the unbounded growth this version
    // removes came from per-transition records and pasted handoff summaries, not
    // from a one-line story boundary.
    base.changeHistory = [
      ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
      { date: timestamp(at), change: `Gates reset for new work item ${epicId || 'none'}::${storyId || 'none'}`, phase: state.session?.currentPhase },
    ];
    return base;
  }

  base.changeHistory = [
    ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
    { date: timestamp(at), change: `Gate reset for new work item ${epicId || 'none'}::${storyId || 'none'}`, phase: state.session?.currentPhase },
  ];
  return base;
}

// ── File helpers ────────────────────────────────────────────────────────────

export function statePathFor(targetDir) {
  return join(targetDir, '.cadet', 'state.json');
}

export function readState(targetDir) {
  const path = statePathFor(targetDir);
  if (!existsSync(path)) return { exists: false, path, state: null };
  try {
    return { exists: true, path, state: JSON.parse(readFileSync(path, 'utf-8')) };
  } catch (err) {
    throw new StateError(`failed to parse ${path}: ${err.message}`);
  }
}

/**
 * Atomically write a JSON document: serialize to a sibling temp file, then
 * rename into place. A process interruption cannot leave a truncated target.
 */
export function writeJsonAtomic(path, value) {
  const payload = JSON.stringify(value, null, 2) + '\n';
  // Verify the payload is valid JSON before it can replace the target.
  JSON.parse(payload);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, payload, 'utf-8');
    renameSync(tmpPath, path);
  } catch (err) {
    try { rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
    throw new StateError(`failed to write ${path}: ${err.message}`);
  }
  return path;
}

/** Atomically write state.json. */
export function writeState(targetDir, state) {
  return writeJsonAtomic(statePathFor(targetDir), state);
}

export { StateError };
