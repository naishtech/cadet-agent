# Learner Config Persistence Rule

**File location:** `.cadet/cadet-local-config.md` (under the `.cadet/` directory).

**Purpose:** Store learner tier, calibration answers, and operating mode preferences so they persist across sessions and `/cadet` invocations don't re-ask the same questions.

**File format (Markdown with YAML frontmatter):**
```yaml
---
learnerTier: 0
gameType: competitive-racing
playerExperience: ai-opponents-campaign
progressionModel: career-tier
operatingMode: full-design-first
unityExperience: beginner
enginePreference: unity
lastUpdated: 2026-05-25
---

# Learner Configuration

This file persists your learner calibration answers so you don't need to re-answer calibration questions on each `/cadet` session.

To update: Answer the calibration questions again and Cadet will refresh this file.
To reset: Delete this file and run `/cadet` to recalibrate from scratch.
```

**When to create/update:**
- Create the file after the first `/cadet` calibration session completes.
- Update the file whenever calibration answers change (learner tier, game type, operating mode shifts).
- Update `lastUpdated` field whenever the file changes.

**When to skip:**
- If the file is missing, proceed with calibration questions and create it.
- If the file exists but is invalid (malformed YAML, missing required fields), ask the user to confirm a fresh calibration and overwrite it.

---

## Backlinks
- Framework index: [README](README.md)
