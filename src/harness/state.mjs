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

export { PHASES, GATES, TRANSITIONS, EVIDENCE_STATUSES };
export { EXCEPTION_CATEGORIES, EXCEPTION_EXPIRY_DAYS };

export const STATE_VERSION = 3;

/** Highest state version this module can read. v1/v2 remain readable. */
export const READABLE_STATE_VERSIONS = Object.freeze([1, 2, 3]);

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
    errors.push({ path: 'version', message: `unsupported state version ${JSON.stringify(version)} (expected 1, 2 or 3)` });
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

  if (version === 2 || version === 3) {
    if (state.gateEvidence !== undefined && !Array.isArray(state.gateEvidence)) {
      errors.push({ path: 'gateEvidence', message: 'gateEvidence must be an array' });
    }
    if (Array.isArray(state.gateEvidence)) {
      state.gateEvidence.forEach((ev, i) => {
        for (const e of validateEvidenceShape(ev, strict)) errors.push({ path: `gateEvidence[${i}].${e.path}`, message: e.message });
      });
    }
    // Gate exceptions are categorised under strict closure (contract v3 §4).
    if (strict && Array.isArray(state.changeHistory)) {
      state.changeHistory.forEach((entry, i) => {
        if (entry?.type !== 'gate-exception') return;
        for (const e of validateGateException(entry, strict)) {
          errors.push({ path: `changeHistory[${i}].${e.path}`, message: e.message });
        }
      });
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
    // before the harness existed can resolve it with a scoped gate exception or
    // by re-recording; silently tolerating it is what let the gap grow.
    if (isPlainObject(state.epics) && Array.isArray(state.gateEvidence)) {
      const evidenced = new Set(
        state.gateEvidence
          .map((e) => (isPlainObject(e) ? e.workItemId : null))
          .filter((id) => typeof id === 'string' && id.length > 0),
      );
      for (const [epicId, epic] of Object.entries(state.epics)) {
        if (!isPlainObject(epic) || !isPlainObject(epic.stories)) continue;
        for (const [storyId, status] of Object.entries(epic.stories)) {
          if (status !== 'done') continue;
          if (evidenced.has(`${epicId}::${storyId}`)) continue;
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
 * Migrate a v1 state document to v2 in memory. Unknown top-level fields are
 * preserved. Does not touch the filesystem.
 */
export function migrateStateV1toV2(v1) {
  if (!isPlainObject(v1)) throw new StateError('cannot migrate a non-object state');
  if (v1.version === 2 || v1.stateVersion === 2) {
    return { state: { ...v1, version: 2, stateVersion: 2, gateEvidence: v1.gateEvidence || [] }, changed: false };
  }
  if (v1.version === 3 || v1.stateVersion === 3) {
    return { state: { ...v1, version: 3, stateVersion: 3, gateEvidence: v1.gateEvidence || [] }, changed: false };
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
  // v1 migrates straight to the current version (v3). The intermediate v2
  // shape is identical for these fields; only the version stamp differs, so a
  // single-step migration avoids a transient on-disk v2 document.
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
  return { state: migrated, changed: true };
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

/**
 * Migrate a state file on disk atomically: write a temporary file, optionally
 * back up the original, then rename into place. A failed migration leaves the
 * original untouched.
 */
export function migrateStateFile(statePath, { backup = true } = {}) {
  if (!existsSync(statePath)) {
    throw new StateError(`state file not found: ${statePath}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch (err) {
    throw new StateError(`cannot migrate malformed state: ${err.message}`);
  }
  const { state, changed } = migrateStateV1toV2(raw);
  if (!changed) return { migrated: false, statePath, state };

  const dir = dirname(statePath);
  const tmpDir = mkdtempSync(join(tmpdir(), 'cadet-state-'));
  const tmpPath = join(tmpDir, 'state.json');
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    if (backup) {
      copyFileSync(statePath, `${statePath}.v1.bak`);
    }
    // A failed rename leaves the original in place; validate before committing.
    // This is a structural-only check: a freshly migrated state has no on-disk
    // evidence to bind, so freshness is intentionally not evaluated here.
    const check = validateState(state, { structuralOnly: true });
    if (!check.valid) {
      throw new StateError(`migrated state failed validation: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }
    renameSync(tmpPath, statePath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return { migrated: true, statePath, state };
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

/** Active gate exceptions keyed by gate, honoring scope and expiry. */
export function activeExceptions(state, { workItemId, now = new Date() } = {}) {
  const history = Array.isArray(state?.changeHistory) ? state.changeHistory : [];
  const active = {};
  for (const entry of history) {
    if (entry?.type !== 'gate-exception') continue;
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
  return {
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
    changeHistory: [
      ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
      { date: timestamp(at), change: `Phase transition ${state.session.currentPhase} → ${toPhase}`, phase: toPhase },
    ],
  };
}

/** Reset all gates to false for a new work item (atomic in the returned copy). */
export function resetGatesForNewWorkItem(state, { epicId = null, storyId = null, at = new Date() } = {}) {
  const gates = {};
  for (const gate of GATES) gates[gate] = false;
  return {
    ...state,
    gates,
    gateEvidence: [],
    activeWorkItem: { epicId, storyId },
    changeHistory: [
      ...(Array.isArray(state.changeHistory) ? state.changeHistory : []),
      { date: timestamp(at), change: `Gate reset for new work item ${epicId || 'none'}::${storyId || 'none'}`, phase: state.session?.currentPhase },
    ],
  };
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
