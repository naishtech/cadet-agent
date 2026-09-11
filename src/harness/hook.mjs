/**
 * Cadet-Agent git-guard hook logic.
 *
 * A single, testable implementation of the PreToolUse decision. The shell and
 * PowerShell hook scripts mirror this logic for host runtimes that cannot import
 * Node modules; tests exercise this module and the scripts against the same
 * payload fixtures.
 *
 * Behavior (contract §9):
 *   - Recognized git write (commit/push/gh pr merge) → `ask`.
 *   - Malformed JSON, or a recognized shell tool with unrecognized input → `hook-error`.
 *   - Non-relevant tool → `pass` (no decision, exit 0).
 *   - `fail-open` compatibility mode is opt-in and logged.
 */

export const RELEVANT_TOOLS = Object.freeze(['run_in_terminal', 'execute', 'bash', 'shell']);

/**
 * Git write patterns.
 *
 * Tolerates intervening options and option values (e.g. `git -c user.name=x commit`):
 * we locate a `git` token and require `commit`/`push` to appear as a standalone
 * token after it, before any command separator.
 */
export const WRITE_PATTERNS = Object.freeze([
  { id: 'git commit', re: /\bgit\b[^;&|]*?\bcommit\b/i },
  { id: 'git push', re: /\bgit\b[^;&|]*?\bpush\b/i },
  { id: 'gh pr merge', re: /\bgh\b[^;&|]*?\bpr\b[^;&|]*?\bmerge\b/i },
]);

/** Command obfuscation used to hide a write: separators, quoting, env prefixes, `$(...)`. */
const OBFUSCATION_NORMALIZERS = [
  (s) => s.replace(/["'`]/g, ''),
  (s) => s.replace(/\\(?=[a-z])/g, ''),
  (s) => s.replace(/\$\{[^}]*\}/g, ' '),
  (s) => s.replace(/\$\([^)]*\)/g, ' '),
  (s) => s.replace(/\s+/g, ' '),
];

function normalizeCommand(input) {
  let out = String(input || '').toLowerCase();
  for (const fn of OBFUSCATION_NORMALIZERS) out = fn(out);
  return out;
}

/** Detect a git write operation in a command string, tolerant of light obfuscation. */
export function detectWrite(command) {
  if (!command) return null;
  const normalized = normalizeCommand(command);
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.re.test(normalized)) return pattern.id;
  }
  return null;
}

function decision(permissionDecision, reason) {
  return {
    exitCode: 0,
    output: permissionDecision
      ? {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision,
          permissionDecisionReason: reason,
        },
      }
      : null,
  };
}

/**
 * Evaluate a raw hook payload string.
 * Returns `{ decision: 'ask'|'deny'|'pass', output, exitCode, diagnostics }`.
 */
export function evaluateHook(rawPayload, { mode = 'ask-on-recognized-write', log = null } = {}) {
  const diagnostics = [];
  const failOpen = mode === 'fail-open';
  const logError = (message) => {
    diagnostics.push(message);
    if (typeof log === 'function') log(message);
    else if (log && typeof log.error === 'function') log.error(message);
  };

  if (rawPayload === null || rawPayload === undefined || String(rawPayload).trim() === '') {
    // No payload: nothing to guard. Treat as pass (the host called us with no input).
    return { decision: 'pass', ...decision(null, ''), diagnostics };
  }

  let payload;
  try {
    payload = JSON.parse(String(rawPayload));
  } catch (err) {
    const message = `git-guard received malformed JSON: ${err.message}`;
    logError(message);
    if (failOpen) {
      return { decision: 'pass', ...decision(null, ''), diagnostics, compatibilityMode: 'fail-open' };
    }
    return {
      decision: 'deny',
      ...decision('deny', 'git-guard blocked the tool call because the hook payload was malformed JSON.'),
      diagnostics,
      code: 'hook-error',
    };
  }

  const toolName = String(payload.toolName || payload.tool_name || payload.tool || '');
  if (!RELEVANT_TOOLS.includes(toolName)) {
    return { decision: 'pass', ...decision(null, ''), diagnostics };
  }

  const raw = payload.toolInput ?? payload.toolArgs ?? payload.command ?? '';
  const commandText = typeof raw === 'string'
    ? raw
    : (raw && typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? ''));

  if (!commandText.trim()) {
    // A recognized shell tool with no readable command is an unrecognized input.
    const message = `git-guard received unrecognized input for tool "${toolName}"`;
    logError(message);
    if (failOpen) {
      return { decision: 'pass', ...decision(null, ''), diagnostics, compatibilityMode: 'fail-open' };
    }
    return {
      decision: 'deny',
      ...decision('deny', 'git-guard blocked the tool call because its input could not be interpreted.'),
      diagnostics,
      code: 'hook-error',
    };
  }

  const detected = detectWrite(commandText);
  if (!detected) {
    return { decision: 'pass', ...decision(null, ''), diagnostics };
  }

  return {
    decision: 'ask',
    ...decision('ask', `${detected} requires explicit user approval per Cadet policy. Review the proposed changes before approving.`),
    diagnostics,
    detected,
  };
}

/** Serialize a hook decision to the JSON the host expects on stdout. */
export function hookOutput(decision) {
  return decision.output ? JSON.stringify(decision.output) : '';
}
