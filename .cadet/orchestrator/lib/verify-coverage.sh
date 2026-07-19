#!/usr/bin/env bash
# verify-coverage.sh — Instruction-loss verification gate
# Scans original source files for executable instructions and verifies
# they are covered in cadet-agent.md or will be preserved in docs/.
#
# Output: report to stdout; exit 0 = all covered, exit 1 = missing items.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CORE_DIR="$REPO_ROOT/.cadet/agent/core"
CONDENSED="$CORE_DIR/cadet-agent.md"

# ── Files to scan ───────────────────────────────────────────────────────────

SOURCE_FILES=(
    "$CORE_DIR/Identity.md"
    "$CORE_DIR/Principles.md"
    "$CORE_DIR/OperatingRules.md"
    "$CORE_DIR/Workflow.md"
    "$CORE_DIR/FirstResponseFormat.md"
    "$CORE_DIR/KickoffFlow.md"
    "$CORE_DIR/GitFirstRule.md"
    "$CORE_DIR/FrameworkSyncGate.md"
    "$CORE_DIR/PolicyAndGuidanceRules.md"
    "$CORE_DIR/TechnologyIntroductionRule.md"
    "$CORE_DIR/Skills/Requirements.md"
    "$CORE_DIR/Skills/Architecture.md"
    "$CORE_DIR/Skills/TDD.md"
    "$CORE_DIR/Skills/Debugging.md"
    "$CORE_DIR/Skills/CodeReview.md"
    "$CORE_DIR/Skills/Orchestrator.md"
)

# ── Instructional markers ───────────────────────────────────────────────────

# Lines matching these patterns are considered "executable instructions"
MARKER_PATTERNS=(
    'MUST '
    'MUST NOT '
    'NEVER '
    'ALWAYS '
    ' mandatory'
    ' required'
    ' non-negotiable'
)

# ── Normalize ────────────────────────────────────────────────────────────────

normalize() {
    # Lowercase, strip markdown links [text](url) → text, collapse whitespace
    echo "$1" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/\[([^]]*)\]\([^)]*\)/\1/g' \
        | sed 's/\*\*//g' \
        | sed 's/`//g' \
        | sed 's/^[[:space:]]*[-*] //' \
        | tr -s '[:space:]' ' ' \
        | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# ── Extract instructions from a file ─────────────────────────────────────────

extract_instructions() {
    local file="$1"
    local in_process=0
    local line_num=0

    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # Track when we enter a process/rule section
        if [[ "$line" =~ ^#[[:space:]]+Process ]] || [[ "$line" =~ ^#[[:space:]]+Rules ]]; then
            in_process=1
            continue
        fi
        if [[ "$line" =~ ^#[[:space:]] ]] && [ "$in_process" -eq 1 ]; then
            in_process=0
        fi

        # Numbered steps in process sections
        if [ "$in_process" -eq 1 ] && [[ "$line" =~ ^[[:space:]]*[0-9]+\. ]]; then
            local normalized
            normalized=$(normalize "$line")
            if [ -n "$normalized" ]; then
                echo "${file}:${line_num}:${normalized}"
            fi
        fi

        # Bullet points with instructional markers
        if [[ "$line" =~ ^[[:space:]]*- ]]; then
            for marker in "${MARKER_PATTERNS[@]}"; do
                if [[ "$line" == *"$marker"* ]]; then
                    local normalized
                    normalized=$(normalize "$line")
                    if [ -n "$normalized" ] && [ ${#normalized} -gt 20 ]; then
                        echo "${file}:${line_num}:${normalized}"
                    fi
                    break
                fi
            done
        fi
    done < "$file"
}

# ── Check if an instruction is covered ───────────────────────────────────────

is_covered_in_condensed() {
    local instruction="$1"
    # Check for substring match (minimum 30 chars to avoid false positives)
    local needle="${instruction:0:60}"
    if grep -q -i -F "$needle" "$CONDENSED" 2>/dev/null; then
        return 0
    fi
    # Try shorter fragments for longer instructions
    if [ ${#needle} -gt 45 ]; then
        local frag="${instruction:10:40}"
        if grep -q -i -F "$frag" "$CONDENSED" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

will_move_to_docs() {
    local source_path="$1"
    # Files that will move to docs/ in Phase 3
    case "$source_path" in
        *"/Guidance/"*|*"/Standards/"*|*"/Templates/"*|*"/Identity.md"|*"/Principles.md"|*"/LearnerModel.md"|*"/LearnerConfigPersistence.md"|*"/PolicyAndGuidanceRules.md"|*"/TechnologyIntroductionRule.md")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    if [ ! -f "$CONDENSED" ]; then
        echo "ERROR: cadet-agent.md not found at $CONDENSED" >&2
        exit 2
    fi

    local missing=()
    local covered=()
    local docs_bound=()
    local total=0

    # Read condensed file once for faster matching
    local condensed_content
    condensed_content=$(cat "$CONDENSED" | tr '[:upper:]' '[:lower:]')

    for src in "${SOURCE_FILES[@]}"; do
        if [ ! -f "$src" ]; then
            continue
        fi

        while IFS= read -r entry; do
            [ -z "$entry" ] && continue
            total=$((total + 1))

            local file_path="${entry%%:*}"
            local rest="${entry#*:}"
            local line_num="${rest%%:*}"
            local instruction="${rest#*:}"
            local short_src="${file_path#$REPO_ROOT/}"

            # Check coverage
            if echo "$condensed_content" | grep -q -i -F "${instruction:0:60}" 2>/dev/null; then
                covered+=("$instruction → $short_src:$line_num")
            elif echo "$condensed_content" | grep -q -i -F "${instruction:10:40}" 2>/dev/null; then
                covered+=("$instruction → $short_src:$line_num")
            elif will_move_to_docs "$file_path"; then
                docs_bound+=("$instruction → $short_src:$line_num")
            else
                missing+=("$instruction → $short_src:$line_num")
            fi
        done < <(extract_instructions "$src")
    done

    # ── Report ────────────────────────────────────────────────────────────────

    echo "# Coverage Report"
    echo ""
    echo "Scanned: ${#SOURCE_FILES[@]} source files"
    echo "Total executable instructions extracted: $total"
    echo ""

    echo "## Covered in cadet-agent.md (${#covered[@]} instructions)"
    for item in "${covered[@]}"; do
        echo "- \`$item\`"
    done
    echo ""

    echo "## Moved to docs/ — rationale only (${#docs_bound[@]} instructions)"
    for item in "${docs_bound[@]}"; do
        echo "- \`$item\`"
    done
    echo ""

    echo "## MISSING — needs action (${#missing[@]} instructions)"
    if [ ${#missing[@]} -eq 0 ]; then
        echo "(none — all instructions covered)"
    else
        for item in "${missing[@]}"; do
            echo "- \`$item\`"
        done
    fi

    # ── Exit code ─────────────────────────────────────────────────────────────

    if [ ${#missing[@]} -eq 0 ]; then
        echo ""
        echo "✅ VERIFICATION PASSED — zero uncovered instructions"
        return 0
    else
        echo ""
        echo "❌ VERIFICATION FAILED — ${#missing[@]} instructions not covered"
        echo "   Add missing items to cadet-agent.md, docs/, or docs/exclusions.md"
        return 1
    fi
}

main "$@"
