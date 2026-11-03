#!/usr/bin/env bash
#
# The Cadet CLI gate.
#
# Six checks, no Cosmos requirement, and the exit code is the verdict. Runs under
# Git Bash on Windows and under bash on macOS and Linux.
#
#   1. every script uses LF endings (a CRLF script does not run under bash)
#   2. every script parses (`bash -n`)
#   3. the JSON parser reads a value from a profile fixture
#   4. the process lock excludes a second holder, and releases
#   5. the profile fixtures match the schema's required fields, and the invalid
#      fixture is rejected
#   6. `dist.sh --help` exits 0

set -u

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CLI_DIR" || exit 1

fail=0
pass() { printf '  PASS  %s\n' "$1"; }
skip() { printf '  SKIP  %s (%s)\n' "$1" "$2"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "Cadet CLI gate — $CLI_DIR"

# 1. Line endings
# Byte comparison, not grep: MSYS grep reads text mode and strips the CR it is
# asked to find, so a CR pattern silently matches everything or nothing.
crlf=""
while IFS= read -r f; do
  bytes=$(wc -c < "$f")
  stripped=$(tr -d '\r' < "$f" | wc -c)
  if [ "$bytes" -ne "$stripped" ]; then crlf="$crlf $f"; fi
done < <(find . -name '*.sh' -type f | sort)
if [ -n "$crlf" ]; then
  bad "line endings: CRLF in$crlf"
else
  pass "line endings are LF"
fi

# 2. Syntax
syntax_bad=""
for f in $(find . -name '*.sh' -type f | sort); do
  bash -n "$f" || syntax_bad="$syntax_bad $f"
done
if [ -n "$syntax_bad" ]; then bad "syntax:$syntax_bad"; else pass "every script parses"; fi

# 3. JSON parser
if command -v jq >/dev/null 2>&1 || [ -n "${COSMOS_BIN_DIR:-}" ]; then
  value="$(source ./Util/json_parser.sh >/dev/null 2>&1; get_json_value ./fixtures/profiles/unity-minimal.json profileName 2>/dev/null)"
  if [ "$value" = "unity-minimal" ]; then
    pass "json_parser reads profileName"
  else
    bad "json_parser returned '$value', expected 'unity-minimal'"
  fi
else
  skip "json_parser" "no jq and no COSMOS_BIN_DIR"
fi

# 4. Process lock
lock_name="cadet_cli_gate_$$"
lock_result="$(
  source ./Util/process_lock.sh >/dev/null 2>&1
  acquire_lock "$lock_name" >/dev/null 2>&1 || echo "acquire-failed"
  acquire_lock "$lock_name" >/dev/null 2>&1 && echo "second-acquire-succeeded"
  release_lock "$lock_name" >/dev/null 2>&1 || echo "release-failed"
)"
if [ -z "$lock_result" ]; then
  pass "process lock excludes a second holder and releases"
else
  bad "process lock: $lock_result"
fi

# 5. Profile fixtures
if command -v node >/dev/null 2>&1; then
  if node ./test/validate-profiles.mjs; then
    pass "profile fixtures match the schema"
  else
    bad "profile fixtures do not match the schema"
  fi
else
  skip "profile fixtures" "node is not on PATH"
fi

# 6. Entry point
if bash ./dist.sh --help >/dev/null 2>&1; then
  pass "dist.sh --help exits 0"
else
  bad "dist.sh --help failed"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "Cadet CLI gate: ok"
else
  echo "Cadet CLI gate: FAILED"
fi
exit "$fail"
