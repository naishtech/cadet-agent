# Purpose

Capture preferred debugging and diagnostics patterns that have worked well in practice so Cadet can investigate Unity defects with concrete evidence before making speculative fixes.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Learner model reference: [../LearnerModel](../LearnerModel.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)
- Debugging skill: [../Skills/Debugging](../Skills/Debugging.md)

## Guidance Role
- This document records preferred debugging heuristics, not mandatory standards.
- Use these patterns when they improve observability, shorten root-cause discovery, or reduce repeated guesswork.
- When a repository policy defines specific logging or diagnostics conventions, the policy wins.

## Preferred Debugging Patterns
- Prefer reproduce-first debugging over speculative code changes.
- Prefer the narrowest possible diagnostic that can confirm or reject the current hypothesis.
- Prefer temporary diagnostics that produce durable evidence, such as file logs or clearly attributable structured messages, when the runtime state cannot be observed directly.
- Prefer logging state transitions, branch decisions, and ownership boundaries instead of dumping unrelated values.
- Prefer removing temporary diagnostics as part of the same fix once the root cause is confirmed.
- Prefer preserving a regression test or a concrete manual reproduction checklist after the issue is fixed.
- Prefer escalating from simple checks to targeted instrumentation only when cheaper evidence has failed to disambiguate the defect.

## Diagnostic Heuristics
- If the defect depends on Unity runtime state, prefer evidence gathered during actual play or execution over static reasoning alone.
- If the same defect has resisted multiple fix attempts, prefer collecting timestamped evidence before changing more code.
- If a failure path is hard to interpret, prefer surfacing a more concrete reason rather than adding more vague logs.
- If a learner is new to debugging, prefer explaining what evidence is missing and why the next diagnostic step is the cheapest discriminator.

## Anti-Patterns
- Changing multiple systems at once before a single root-cause hypothesis is confirmed.
- Leaving broad or always-on debug output after the issue has been solved.
- Adding diagnostics that cannot be attributed back to a specific subsystem or decision point.
- Treating guidance-level logging preferences as mandatory when the repository policy defines a different convention.

---