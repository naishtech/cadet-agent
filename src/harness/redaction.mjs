/**
 * Cadet-Agent redaction.
 *
 * Removes secrets from structured values and bounded output before ledger
 * persistence and before report display. Covers: bearer/basic auth headers, API
 * keys and common provider prefixes, JWTs, private keys/certificates,
 * passwords and password-like keys, connection strings, cloud access keys,
 * npm/GitHub tokens, and secret values nested in arrays or objects.
 *
 * Contract: docs/core/HarnessContract.md §8.
 */

export const REDACTED = '[REDACTED]';

/** Key names whose *values* are always redacted, case-insensitive, substring match. */
const SECRET_KEY_PATTERNS = [
  /pass(word|phrase)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /apikey/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /access[_-]?key/i,
  /auth(orization)?/i,
  /credential/i,
  /connection[_-]?string/i,
  /conn[_-]?str/i,
  /^pwd$/i,
  /session[_-]?id/i,
  /cookie/i,
];

/** Value patterns redacted regardless of key. Applied in order. */
const VALUE_RULES = [
  // Bearer / Basic auth headers
  { name: 'auth-header', re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  // JWTs (three base64url segments)
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  // Private key blocks
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'certificate', re: /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g },
  // Provider-prefixed API keys
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9-]{16,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9-]{16,}\b/g },
  { name: 'stripe-key', re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'github-token', re: /\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack-token', re: /\bxox[abopr]-[A-Za-z0-9-]{10,}\b/g },
  // Connection strings with embedded credentials
  { name: 'connection-string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@[^\s'"]+/gi },
  // Generic long hex/base64 secrets assigned via `=` or `:`
  { name: 'assigned-secret', re: /\b(secret|password|passwd|pwd|token|apikey|api_key)\s*[=:]\s*["']?([A-Za-z0-9._~+/=-]{12,})["']?/gi, keepPrefix: true },
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Redact secrets inside a string value. */
export function redactString(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const rule of VALUE_RULES) {
    if (rule.keepPrefix) {
      out = out.replace(rule.re, (match, key) => `${key}=${REDACTED}`);
    } else {
      out = out.replace(rule.re, REDACTED);
    }
  }
  return out;
}

function keyIsSecret(key) {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Deeply redact a structured value. Arrays and nested objects are traversed.
 * Secret-like keys always have their values replaced; secret-shaped strings are
 * redacted regardless of key.
 */
export function redact(value, { maxDepth = 12 } = {}) {
  return redactValue(value, 0, maxDepth);
}

function redactValue(value, depth, maxDepth) {
  if (depth > maxDepth) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1, maxDepth));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (keyIsSecret(key)) {
        out[key] = v === null || v === undefined ? v : REDACTED;
      } else {
        out[key] = redactValue(v, depth + 1, maxDepth);
      }
    }
    return out;
  }
  return value;
}

/**
 * Detect whether a value contains anything that would be redacted, without
 * returning the secret. Useful for tests and for flagging suspicious payloads.
 */
export function containsSecret(value) {
  let found = false;
  const visit = (v) => {
    if (found) return;
    if (typeof v === 'string') {
      if (redactString(v) !== v) found = true;
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (isPlainObject(v)) {
      for (const [k, child] of Object.entries(v)) {
        if (keyIsSecret(k) && child !== null && child !== undefined && child !== '') { found = true; return; }
        visit(child);
      }
    }
  };
  visit(value);
  return found;
}

/** Bundled regex source for each named category (used by the fixture coverage test). */
export const REDACTION_CATEGORIES = Object.freeze(
  Object.fromEntries(VALUE_RULES.map((r) => [r.name, r.re.source]))
);
