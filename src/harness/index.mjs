/**
 * Cadet-Agent harness — stable internal entry point.
 *
 * The CLI and tests import from here so they never depend on the file layout of
 * the individual harness modules.
 */

export {
  PHASES, GATES, TRANSITIONS, EVIDENCE_STATUSES, RETRY_CLASSES, CONTEXT_TIERS,
  DEFAULT_BUDGETS, HARD_CEILINGS, DEFAULT_ARCHIVE_LIMITS, DEFAULT_OUTPUT_POLICY,
  DEFAULT_RETENTION, DEFAULT_ESTIMATION, DEFAULT_HOOK_POLICY, DEFAULT_STRICT_CLOSURE,
  EXCEPTION_CATEGORIES, EXCEPTION_EXPIRY_DAYS, EXCEPTION_REQUIRES_REVIEW_NOTE, AGENT_OWNED_GATES,
  validatePolicy, defaultPolicy, loadPolicy, budgetForScope, policyPath, PolicyError,
} from './policy.mjs';

export {
  BudgetTracker, budgetExhaustedResult, budgetReport, evaluateHardStop,
  estimateTokens, estimateCost, normalizeUsage, BUDGET_RESULTS,
} from './budget.mjs';

export {
  newId, isUuid, sha256, sha256Bytes, hashFile, hashTree, hashCriteria, timestamp, canonicalJson, changedFiles, gitChangedFiles,
} from './util.mjs';

export {
  STATE_VERSION, READABLE_STATE_VERSIONS, validateState, migrateStateV1toV2, migrateStateFile,
  createEvidence, computeInputTreeHash, workItemIdOf, evidenceFreshness,
  latestEvidenceForGate, activeExceptions, requiredGates, evaluateTransition, resolveStrict,
  applyTransition, resetGatesForNewWorkItem, statePathFor, readState, writeState, writeJsonAtomic, StateError,
} from './state.mjs';

export {
  RETRY_CLASSES as VERIFICATION_RETRY_CLASSES, RESULT_STATUSES, TRANSIENT_BACKOFF_MS,
  DEFAULT_FLAKY_SIGNATURES, classifyResult, classifyRepair, runCommand,
  commandForGate, analyzerClean, runVerificationLoop, manualConfirmation, isBudgetExhaustion,
} from './verification.mjs';

export {
  ContextManifest, buildBaseManifest, tier0References, TIER_REASONS_REQUIRED,
  DEFAULT_MAX_EXPANSION_PER_STEP, ContextError,
} from './context.mjs';

export {
  TOOL_KINDS, ROUTING_REASONS, detectCapabilities, routeTask, toolCallSpan, RoutingError,
} from './routing.mjs';

export { redact, redactString, containsSecret, REDACTED, REDACTION_CATEGORIES } from './redaction.mjs';

export {
  RUN_SCHEMA_VERSION, RunLedger, loadRun, listRuns, cleanupRuns, buildReport, formatReport,
  runsDir, LedgerError,
} from './ledger.mjs';

export {
  extractArchive, readArchiveEntry, readEntries, assertContained, crc32, findEocd,
  ArchiveError, DEFAULT_ARCHIVE_LIMITS as ARCHIVE_LIMITS,
} from './archive.mjs';

export {
  RELEVANT_TOOLS, WRITE_PATTERNS, detectWrite, evaluateHook, hookOutput,
} from './hook.mjs';

export {
  REPO_ROLES, REPO_ROLE_MARKER, detectRepoRole, isFrameworkSourceWithoutWorkItem, describeRepoRole,
} from './repo-role.mjs';

export {
  INVENTORY_FORMATS, COVERAGE_STATUSES, DEFAULT_MAX_REPORT_BYTES, DEFAULT_MAX_INVENTORY_ENTRIES,
  normalizeTestName, parseTestInventory, parseStoryCriteria, parseStoryCriteriaText,
  compareCoverage, describeCoverageGaps,
} from './verify-acs.mjs';
