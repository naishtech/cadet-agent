# Human Acceptance: <slot id="epic" note="The epic this acceptance closes."/>

Accepted by: <slot id="acceptor" note="Your name, not a role. The framework records the gate; it never supplies the acceptance, and no agent can make this record on your behalf."/>
Date: <slot id="date" fmt="ISO-8601"/>
Files: <slot id="files" fmt="repository-relative paths" note="The files this acceptance covers. The command binds them, so editing one after the acceptance makes it stale rather than leaving it looking current. Add or remove paths as the scope really is."/>
Environment: <slot id="environment" fmt="key=value pairs" note="Where the acceptance applies, including the revision — `revision=<sha>`, `editor=<version>`. A later build invalidates it, which is why the revision belongs here and not in prose."/>

## Witness

<slot id="witness" note="What you did, and what you saw. 'Reviewed the build' is not a witness; 'launched the level, fired the tower, watched the wave advance' is. This becomes the record's witness, and it is required — an acceptance with no witness is a signature on nothing."/>

## Scope reviewed

<slot id="scopeReviewed" note="What this acceptance covers, and where it stops. An acceptance that does not say where it stops will be read as covering everything."/>

## Accepted limitations

<slot id="limitations" note="What you accepted as missing, broken, or deliberately out of scope. Write the literal `none` when there are none, so that 'we did not look' and 'we looked and found nothing' are different statements in the record."/>

## Candidates from state

<slot id="candidates" note="What the record says is outstanding for this epic. Read it, then keep what applies in the section above and ignore the rest. This list is help, not evidence: only the Accepted limitations section is recorded."/>

---

## Recording

<slot id="recording" note="The exact commands. This section is instructions and is not part of the record."/>
