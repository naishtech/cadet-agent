# Testing — Unity pack

How a Unity test is written, where it runs, and what it leaves behind for the harness.

## What this page covers

The test framework the engine owns, the two modes a test can run in, the command that runs them, and the report the harness reads.

## Commands

| Task | Command |
|---|---|
| Run every test | `unity test <project> --format json` |
| Run and keep the report | `unity test <project> --format json --output <dir>` |
| Run one platform | `unity test <project> --testPlatform EditMode` (or `PlayMode`) |
| Record the gate from a report | `cadet-agent harness verify --gate testsPassed` |
| Check declared tests actually ran | `cadet-agent harness verify-acs --story <path>` |

A failed test exits `6` (primary operation failed), not `1`. Treat `6` as a red result with a report, and parse the report rather than the prose.

## The framework the engine owns

- Use the engine's own runner: NUnit-style attributes inside the Unity Test Framework. Do not add xUnit, MSTest or a standalone NUnit package; the engine's runner is what the batch command drives and what the gate reads.
- `[Test]` runs a synchronous test. `[UnityTest]` returns `IEnumerator` and yields, which is the only way to step a coroutine or wait a frame. `[TestCase]` and `[Values]` parametrise without a loop.
- **EditMode** is for pure logic, editor tooling and anything that does not need a frame. **PlayMode** is for lifecycle callbacks, physics, coroutines, and anything whose truth appears over time. A PlayMode test that asserts on a single frame has usually chosen the wrong mode.
- A test assembly needs its own `.asmdef`, with the test assemblies referenced. A test file placed outside one is compiled into the runtime assembly and ships.
- A PlayMode test that needs a scene loads it explicitly and asserts the load succeeded. A test that depends on whatever scene the editor had open is not a test.

## Rules

1. **Write the red test first.** A test that has never failed has not been shown to test anything. Record the failing run before the fix.
2. **Wait on frames, not wall-clock time.** `yield return null` advances one frame; `WaitForSeconds` makes the suite slow and its result depend on machine speed.
3. **Fix the seed and the clock** in anything randomised or time-based, or the suite's result becomes a machine property.
4. **Assert on behaviour, not on the scene graph's internals.** A test that reads private fields of a component breaks on every refactor and proves nothing a caller cares about.
5. **Keep one reason to fail per test.** A test that checks four things reports the first failure and hides the rest.
6. **Do not weaken a test to make it pass.** If the behaviour is wrong, the test is right; if the test is wrong, say which expectation was wrong before changing it.

## Verification

- The gate is `testsPassed`. It wants a passing run **and** a red run before it — the harness refuses a green with no red for the same work item.
- `cadet-agent harness verify --gate testsPassed` runs the project's declared `testCommand`; this pack explains the Unity form of that command, and `.cadet/harness.json` holds which one this project uses.
- `cadet-agent harness verify-acs` compares the story's declared test names against the report's inventory. A renamed test breaks that mapping even when it passes, so keep the name stable or update the story in the same change.
- The report is the artifact: keep its path and hash with the evidence. A test command that never launched is `blocked`, not red — install the editor or declare a command that runs.
