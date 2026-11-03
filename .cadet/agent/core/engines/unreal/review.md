# Planning review — Unreal pack

The questions to put to an Unreal plan before a design is written. The interview — one question at a time, re-pruned after every answer — is PlanningReview in the core skills; this page supplies the Unreal question set and what a good answer changes.

## What this page covers

The questions that decide how expensive an Unreal change is: module ownership, the C++/Blueprint split, reflected surfaces, what has to close or cook, the engine version, and how the change will be proved.

## Questions

1. **Which module owns this, and is it a module that already exists?** — The answer fixes the build cost of every later slice. "A new module" is an acceptable answer, but only when it comes with the reason `{{gameModule}}` cannot hold the type.

2. **Does the logic live in C++, Blueprint, or both — and which side is the source of truth?** — A Blueprint that duplicates a C++ path, or a C++ type that exists only to host a graph, is a boundary nobody will maintain. The answer should name one owner and say what the other side only tunes.

3. **Does the change add or alter a reflected type, or a header other modules include?** — This is the difference between an incremental build and a full rebuild plus an editor restart, and it decides how the work slices.

4. **Does it need a `.Build.cs` dependency, and is that edge public or private?** — A public edge reaches every dependent module. If the answer is "public", ask which public header exposes the type that needs it.

5. **What does the user do to see this working — in the editor, in PIE, in a cooked build, or in a test?** — The witness step sets the rest of the cost. Everything before it is unverifiable, and a cooked-build-only witness commits the plan to a cook per slice.

6. **Does seeing it require a cook, a shader compile, or a lighting bake?** — Ask for the estimate. A plan whose only evidence path is a forty-minute cook is a plan to restructure, not to schedule.

7. **Which existing subsystem, component, or plugin already does part of this?** — Answer it by inspecting `{{projectRoot}}`, never from memory. The follow-up asks what the existing thing must gain, and whether that gain is additive.

8. **Is this replicated, and which side owns authority?** — A behaviour that looks local in single-player changes shape once a server decides it. The answer names the owning side and what the client may predict.

9. **Which engine version is the target, and does every API and plugin in the plan exist in it?** — Read it from `EngineAssociation` in `{{uproject}}`, then check the engine install. A plan built on an API from a newer engine has quietly become an engine upgrade.

10. **What is the cheapest test that would prove the behaviour?** — If it is an automation test, name the module that hosts it and the command `{{testCommand}}` runs. If it is not, name the artifact that stands in for it.

11. **Who closes the editor, and when?** — Every C++ slice needs the editor down in order to link. A plan that never says who closes it and who reopens it will be blocked by whoever has the project open, and that delay is not a build problem.

12. **What is the riskiest assumption, and what is the smallest thing that would disprove it?** — The answer should be concrete enough to run today: one map, one Blueprint, one log line. An assumption that can only be tested once the whole feature exists was deferred, not de-risked.

13. **What is the rollback — one `.cpp` and a rebuild, or a content migration?** — A code change reverts with its commit. A moved asset, a renamed Blueprint interface or a changed plugin surface may not.

## Verification

- Every question above is answered in the shared-understanding document, or recorded as deferred with the reason deferring it is safe.
- The "where it lives" line names a module and a C++/Blueprint owner. A blank there means the plan is not plannable yet, whatever else the document says.
- Each claim about existing code or assets cites an inspection of `{{projectRoot}}`. "Nothing like this exists" is a search result, not a recollection.
- The riskiest assumption is named, and the cheapest disproving step sits beside it — one map, one Blueprint, one log line, not a phase.
- Answers that came from discovery are recorded as discovery, so nobody later reads them as a user decision.
