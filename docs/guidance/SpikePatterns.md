# Purpose

Capture preferred spike practices so Cadet defaults to well-scoped, safely isolated feasibility work rather than exploratory code that bleeds into production paths.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)
- Architecture guidance: [ArchitecturePatterns](ArchitecturePatterns.md)

## Guidance Role
- This document records preferred spike practices, not a mandatory standard.
- Apply this guidance whenever exploratory or feasibility work is needed.
- When a standard or active repository policy defines specific spike or prototyping rules, that requirement wins.

## What A Spike Is
A spike is a time-boxed, question-scoped exploration used to answer a single concrete feasibility question before committing to a production approach. It is not a prototype feature, not a first-draft implementation, and not a stepping stone into production code.

## Preferred Spike Practices

### Before starting a spike
- Define the exact feasibility question the spike must answer before writing any code. For example: "Can we demonstrably stream level data from a remote bundle in under 2 seconds on the target device?"
- If the question cannot be stated concisely in one sentence, the scope is probably too broad. Split it first.
- For a new feature or mechanic, prefer a quick spike to get the simplest demonstrable version working end to end before investing in polish, extensibility, or production cleanup.

### During a spike
- Keep spike code isolated in a clearly named folder, scene, or assembly that signals it is exploratory (for example, `Spikes/`, `_spike/`, or `Prototype/`).
- Do not wire spike code into production systems, shared infrastructure, or release paths while the spike is active.
- Treat spike code as reference material, not draft production code.

### After a spike
- Once the feasibility question is answered, treat the spike output as reference-only. Do not let production code depend on spike assets, scripts, or configurations unless explicitly directed otherwise.
- Keep production code paths separate from spike content even after the spike is complete.
- After the full production implementation of the spiked feature is complete, ask the user whether the spike should be removed from the repository.

## When To Defer
- Defer to standards for non-negotiable quality gates such as testing, security, and performance discipline. Spike code does not exempt changes from these gates when the spike outputs are promoted into production.
- Defer to an active repository policy if it defines specific prototyping directories or spike lifecycle rules.

## Anti-Patterns
- Starting a spike without defining the feasibility question first.
- Letting production systems depend on spike code before a clean production implementation is complete.
- Keeping spike code in the repository indefinitely after production completion without asking the user whether it should be removed.
- Treating a spike as a first draft rather than a question-answering experiment.
- Polishing or generalizing spike code before the core feasibility question is confirmed.

---
