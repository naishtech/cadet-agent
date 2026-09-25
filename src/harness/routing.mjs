/**
 * Cadet-Agent tool routing.
 *
 * Applies the tool-selection decision tree (contract §8) and capability
 * fallbacks. Routing never pretends a live capability exists: when MCP is
 * unavailable the call falls back to static context and CLI verification.
 * Live-editor mutation requires explicit user confirmation.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const TOOL_KINDS = Object.freeze(['cli', 'read', 'search', 'mcp', 'write', 'manual']);

export const ROUTING_REASONS = Object.freeze({
  verification: 'deterministic CLI for verification (exit-code driven)',
  staticContext: 'repository read/search for static context',
  liveInspection: 'MCP for live Unity inspection or mutation',
  unavailable: 'capability unavailable — falling back to a safe alternative',
});

class RoutingError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'RoutingError';
    Object.assign(this, detail);
  }
}

/**
 * Detect the capability set. Nothing here contacts the network or the Editor;
 * it only reports what the environment supports.
 */
export function detectCapabilities({ targetDir = process.cwd(), env = process.env, runner = defaultRunner } = {}) {
  const unity = which('unity', { env, runner });
  const mcpConfigured = existsSync(join(targetDir, '.vscode', 'mcp.json'))
    || existsSync(join(targetDir, '.cursor', 'mcp.json'))
    || existsSync(join(targetDir, '.mcp.json'));

  return {
    cli: true,
    unityCli: unity.available ? { available: true, path: unity.path, version: unity.version } : { available: false },
    mcp: mcpConfigured ? { available: true, configured: true } : { available: false, configured: false },
    hook: {
      copilot: existsSync(join(targetDir, '.github', 'hooks', 'git-guard.json')),
      note: 'Cursor, Continue, and Claude Code have no native PreToolUse hook',
    },
    tokenTelemetry: { provider: false, source: 'estimate' },
    costTelemetry: { available: false, reason: 'no model rate card configured' },
  };
}

function defaultRunner(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true, shell: false });
}

/**
 * Every PATH match for `cmd`, in resolution order, or an empty array when it does
 * not resolve. `where` is used on Windows and `which` elsewhere, with `shell: false`
 * so a probe can never itself be reinterpreted by a shell.
 */
export function whichAll(cmd, { runner = defaultRunner } = {}) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const res = runner(probe, [cmd]);
  if (!res || res.status !== 0 || !res.stdout) return [];
  return String(res.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function which(cmd, { env, runner }) {
  const [path] = whichAll(cmd, { runner });
  if (!path) return { available: false };
  let version = null;
  try {
    const v = runner(cmd, ['--version']);
    if (v && v.status === 0 && v.stdout) version = String(v.stdout).trim().split(/\r?\n/)[0];
  } catch { /* version is optional */ }
  return { available: true, path, version };
}

/**
 * Decide which tool to use for a task. Returns a routing decision with a reason
 * and the fallback that was applied, if any.
 */
export function routeTask({ task, capabilities = {} } = {}) {
  if (!task || !TOOL_KINDS.includes(task.kind)) {
    throw new RoutingError(`unknown task kind "${task?.kind}"`);
  }

  const decide = (tool, reason, extra = {}) => ({
    tool,
    kind: task.kind,
    reason,
    fallbackApplied: false,
    ...extra,
  });

  switch (task.kind) {
    case 'cli':
    case 'manual':
      return decide(task.kind, ROUTING_REASONS.verification);

    case 'read':
    case 'search':
      return decide(task.kind, ROUTING_REASONS.staticContext);

    case 'write': {
      // A write to a live Editor is a mutation and needs confirmation.
      if (task.target === 'live-editor') {
        if (!task.userConfirmed) {
          throw new RoutingError('live-editor mutation requires explicit user confirmation', { blocked: true, requiresConfirmation: true });
        }
        if (!capabilities.mcp?.available) {
          return decide('manual', ROUTING_REASONS.unavailable, {
            fallbackApplied: true,
            fallback: 'live-editor mutation requested but MCP is unavailable; ask the user to perform it',
          });
        }
        return decide('mcp', ROUTING_REASONS.liveInspection, { userConfirmed: true });
      }
      return decide('write', 'repository write within the workspace');
    }

    case 'mcp': {
      if (capabilities.mcp?.available) {
        return decide('mcp', ROUTING_REASONS.liveInspection);
      }
      // Never pretend live inspection occurred.
      const fallback = task.fallback === 'cli' || task.verification
        ? decide('cli', ROUTING_REASONS.unavailable, { fallbackApplied: true, fallback: 'static context + CLI verification' })
        : decide('read', ROUTING_REASONS.unavailable, { fallbackApplied: true, fallback: 'static context only' });
      return { ...fallback, liveInspectionPerformed: false };
    }

    default:
      throw new RoutingError(`unhandled task kind "${task.kind}"`);
  }
}

/**
 * Record a tool call. Arguments are sanitized by the caller (see redaction.mjs)
 * before persistence; this function only shapes the span.
 */
export function toolCallSpan({ tool, args = {}, rationale, startedAt, finishedAt, durationMs, resultClass, outputBytes = 0, artifactPath = null, exitCode = null, retryNumber = 0 }) {
  return {
    kind: 'tool-call',
    tool,
    args,
    reason: rationale,
    startedAt,
    finishedAt,
    durationMs,
    result: resultClass,
    outputBytes,
    artifactPath,
    exitCode,
    retryNumber,
  };
}

export { RoutingError };
