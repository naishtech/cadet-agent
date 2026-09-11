/**
 * Cadet-Agent context management.
 *
 * Builds a context manifest with tier, reason, authority, content hash, and size
 * estimate for every loaded item. Deduplicates repeat content by hash before
 * budget accounting, marks stale items when files change, and enforces a bounded
 * expansion budget.
 *
 * Contract: docs/core/HarnessContract.md §7 (context tiers).
 */

import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { CONTEXT_TIERS } from './policy.mjs';
import { hashFile, sha256, timestamp } from './util.mjs';
import { BudgetTracker } from './budget.mjs';

export { CONTEXT_TIERS };

/** Default reason used when a tier requires an explicit justification. */
export const TIER_REASONS_REQUIRED = Object.freeze(['tier2', 'tier3']);

/** Default maximum number of new context items a single step may add. */
export const DEFAULT_MAX_EXPANSION_PER_STEP = 12;

class ContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContextError';
  }
}

function assertTier(tier) {
  if (!CONTEXT_TIERS.includes(tier)) {
    throw new ContextError(`unknown context tier "${tier}" (expected one of ${CONTEXT_TIERS.join(', ')})`);
  }
}

function resolveWithin(rootDir, reference) {
  const normalizedRoot = normalize(rootDir).replace(/[\\/]+$/, '');
  const abs = normalize(join(rootDir, reference));
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + sep)) {
    throw new ContextError(`context reference escapes the workspace: ${reference}`);
  }
  return abs;
}

/**
 * A context manifest for one run/step. Records load decisions; never stores file
 * contents, only hashes and sizes.
 */
export class ContextManifest {
  constructor({ policy, budgets = null, rootDir = process.cwd(), maxExpansionPerStep = DEFAULT_MAX_EXPANSION_PER_STEP } = {}) {
    this.policy = policy;
    this.rootDir = rootDir;
    this.tracker = budgets || new BudgetTracker(policy);
    this.maxExpansionPerStep = maxExpansionPerStep;
    this.items = [];
    this.seenHashes = new Map(); // hash -> canonical item
    this.bytesAddedThisStep = 0;
    this.stepCount = new Map(); // step label -> items added
    this.deduplicated = 0;
    this.denied = [];
  }

  /**
   * Register a context load. Returns `{ item, deduplicated, counted }`.
   * Duplicate content (same hash) is not counted against the context budget again.
   */
  load({ reference, tier = 'tier1', reason = null, authority = 'repository', step = 'step', content = null, bytes = null } = {}) {
    assertTier(tier);
    if (!reference) throw new ContextError('context reference is required');
    if (TIER_REASONS_REQUIRED.includes(tier) && !reason) {
      throw new ContextError(`tier ${tier} requires a recorded reason`);
    }

    const abs = resolveWithin(this.rootDir, reference);
    const exists = existsSync(abs);
    const fileBytes = exists && statSync(abs).isFile() ? statSync(abs).size : (bytes ?? (content != null ? Buffer.byteLength(String(content), 'utf-8') : 0));
    const hash = exists && statSync(abs).isFile()
      ? hashFile(abs)
      : sha256(content != null ? String(content) : reference);

    // Deduplicate by content hash before counting against the budget.
    if (this.seenHashes.has(hash)) {
      this.deduplicated++;
      const canonical = this.seenHashes.get(hash);
      const item = {
        reference,
        tier,
        reason: reason || `duplicate of ${canonical.reference}`,
        authority,
        hash,
        bytes: fileBytes,
        estimatedTokens: estimateTokensForBytes(fileBytes, this.policy),
        loadedAt: timestamp(),
        step,
        deduplicated: true,
        exists,
        stale: false,
      };
      this.items.push(item);
      return { item, deduplicated: true, counted: false };
    }

    const item = {
      reference,
      tier,
      reason,
      authority,
      hash,
      bytes: fileBytes,
      estimatedTokens: estimateTokensForBytes(fileBytes, this.policy),
      loadedAt: timestamp(),
      step,
      deduplicated: false,
      exists,
      stale: false,
    };

    // Expansion budget: bounded per step.
    const stepItems = this.stepCount.get(step) || 0;
    if (stepItems >= this.maxExpansionPerStep) {
      this.denied.push({ reference, tier, reason: 'per-step context expansion limit reached' });
      throw new ContextError(`context expansion limit reached for ${step} (${this.maxExpansionPerStep})`);
    }

    // The context-token budget is a hard limit: adding this item must not push
    // the run past it. Reject before recording so the manifest stays accurate.
    const prospectiveTokens = this.tracker.counters.contextTokens + item.estimatedTokens;
    const budgetCheck = this.tracker.check('contextTokens');
    if (budgetCheck.hard !== null && prospectiveTokens > budgetCheck.hard) {
      this.denied.push({ reference, tier, reason: 'context token budget exhausted' });
      throw new ContextError(
        `context token budget exhausted: adding ${reference} would use ${prospectiveTokens} of ${budgetCheck.hard}`
      );
    }

    this.tracker.add('contextTokens', item.estimatedTokens);
    this.stepCount.set(step, stepItems + 1);
    this.seenHashes.set(hash, item);
    this.items.push(item);
    return { item, deduplicated: false, counted: true };
  }

  /** Mark items stale whose file hash changed or whose work item no longer matches. */
  refresh({ changedReferences = null } = {}) {
    const stale = [];
    for (const item of this.items) {
      if (item.deduplicated) continue;
      const abs = resolveWithin(this.rootDir, item.reference);
      const currentHash = existsSync(abs) && statSync(abs).isFile() ? hashFile(abs) : null;
      const changed = changedReferences
        ? changedReferences.includes(item.reference)
        : currentHash !== item.hash;
      if (changed) {
        item.stale = true;
        stale.push({ reference: item.reference, reason: 'content hash changed or work item changed' });
      }
    }
    return { stale, anyStale: stale.length > 0 };
  }

  /** Items that are currently usable as evidence context. */
  freshItems() {
    return this.items.filter((i) => !i.stale && !i.deduplicated && i.exists);
  }

  manifest() {
    const uniqueBytes = this.items.filter((i) => !i.deduplicated).reduce((a, i) => a + i.bytes, 0);
    return {
      rootDir: this.rootDir,
      items: this.items.map((i) => ({ ...i })),
      deduplicated: this.deduplicated,
      uniqueBytes,
      totalBytes: this.items.reduce((a, i) => a + i.bytes, 0),
      denied: [...this.denied],
      budget: this.tracker.result(),
    };
  }

  /** Human/JSON-safe summary showing why each item was loaded. */
  report() {
    return this.items.map((i) => ({
      reference: i.reference,
      tier: i.tier,
      reason: i.reason,
      authority: i.authority,
      hash: i.hash,
      bytes: i.bytes,
      estimatedTokens: i.estimatedTokens,
      deduplicated: i.deduplicated,
      stale: i.stale,
    }));
  }
}

function estimateTokensForBytes(bytes, policy) {
  const per = policy?.estimation?.bytesPerToken || 3;
  return Math.ceil((bytes || 0) / per);
}

/**
 * Tier 0 context that must always be loaded. Missing entries are reported rather
 * than silently skipped.
 */
export function tier0References(targetDir) {
  return [
    { reference: '.cadet/agent/core/cadet-agent.md', authority: 'framework' },
    { reference: '.cadet/harness.json', authority: 'framework', optional: true },
    { reference: '.cadet/state.json', authority: 'session', optional: true },
  ].map((r) => ({ ...r, abs: join(targetDir, r.reference), present: existsSync(join(targetDir, r.reference)) }));
}

/** Build a manifest seeded with Tier 0 items. */
export function buildBaseManifest({ targetDir, policy, budgets = null } = {}) {
  const manifest = new ContextManifest({ policy, budgets, rootDir: targetDir });
  const missingTier0 = [];
  for (const ref of tier0References(targetDir)) {
    if (!ref.present) {
      if (!ref.optional) missingTier0.push(ref.reference);
      continue;
    }
    manifest.load({ reference: ref.reference, tier: 'tier0', reason: 'always-load tier 0 context', authority: ref.authority, step: 'tier0' });
  }
  return { manifest, missingTier0 };
}

export { ContextError };
