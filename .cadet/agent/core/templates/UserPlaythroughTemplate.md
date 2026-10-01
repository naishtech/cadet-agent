# User Playthrough: <slot id="story" note="The story whose deliverable is played."/>

Played by: <slot id="player" note="Your name, not a role. The framework records what you did; it never plays the game for you, and no agent can make this record on your behalf."/>
Date: <slot id="date" fmt="ISO-8601"/>
Revision: <slot id="revision" fmt="<sha> because a later build invalidates this record"/>
Files: <slot id="files" fmt="repository-relative paths" note="The files this playthrough covers. The command binds them, so editing one afterwards makes the record stale rather than leaving it looking current."/>
Environment: <slot id="environment" fmt="key=value pairs" note="Where the playthrough happened — `editor=<version>` or `player=<build>`, and the scene or level you entered."/>

## What I did

<slot id="witness" note="What you did in the running game, and what you saw. 'It works' is not a witness; 'started the slice scene, let the first wave land, watched the horde walk the map and stop at the wall' is. This becomes the record's witness, and it is required — a playthrough nobody describes is a signature on nothing."/>

## What the story claims

<slot id="instruction" note="The story's own Play: line, copied here so the record shows what was being checked. If this does not match what you saw, the finding belongs in the limitations section."/>

## Accepted limitations

<slot id="limitations" note="What you accepted as missing, broken, unimplemented or deliberately out of scope, and what you could not judge. Write the literal `none` when there are none, so that 'we did not look' and 'we looked and found nothing' are different statements in the record. Fun, feel and clarity belong here: they are the judgements only a person can make."/>

## Candidates from state

<slot id="candidates" note="What the record says is still open for this story. Read it, then keep what applies in the sections above and ignore the rest. This list is help, not evidence: only the sections above are recorded."/>

---

## Recording

<slot id="recording" note="The exact commands. This section is instructions and is not part of the record."/>
