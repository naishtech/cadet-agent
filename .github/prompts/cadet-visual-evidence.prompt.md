---
description: "Cadet Visual Evidence skill: inspect a rendered frame and record what was actually visible as citable evidence."
---

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/VisualEvidence.md` as the primary instruction context — in full, including the `<role>` block (it defines the persona for this turn). Follow every step in that file: gate check, required inputs, capture requirements, process, expected outputs, and completion criteria.

When this skill is dispatched from a phase skill, read the invoking skill's file first (`.cadet/agent/core/skills/Debugging.md`, `CodeReview.md`, or `Spike.md`) so the finding answers the question that was actually asked.
