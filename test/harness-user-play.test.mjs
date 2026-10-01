/**
 * The `Play:` declaration and the `userPlaythroughConfirmed` gate.
 *
 * These tests cover the three claims the change is made of:
 *   1. the declaration parses and validates in exactly two forms, and every way of
 *      dodging it — silence, an unexplained deferral, a deferral to nothing, a deferral
 *      to itself, a deferral whose owner has already landed — is refused;
 *   2. the gate is appended to `review -> validation` (the story boundary) and to
 *      nothing else, only when `userPlay.enabled` is set, and never revalidated at
 *      closure, where the epic's own acceptance gate covers the whole epic;
 *   3. it is HUMAN-OWNED in the registry — no automated path, no project command — so
 *      no command can answer "the person played it" on their behalf.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GATES, requiredGates, TRANSITIONS, MANUAL_ONLY_GATES, USER_PLAY_GATE,
  gateBuilder, manualOnlyGateNames, auditGateRegistry,
  parsePlayDeclarationText, validatePlayDeclaration,
  readSiblingPlayDeclarations, describePlayGaps,
} from '../src/harness/index.mjs';

const STORY_REQUIRED = [
  '# Story: The separation pass',
  'Status: Planned',
  'Reachability: witnessed — press Play and watch the horde',
  'Play: required — start the slice scene, let the first wave land, and watch the horde walk to the wall',
  '',
  '## Acceptance Criteria',
].join('\n');

const STORY_DEFERRED = [
  '# Story: A library nothing reaches yet',
  'Reachability: deferred to epic-1::story-2.md — nothing wires it in yet',
  'Play: deferred to epic-1::story-2.md — it has no runtime surface until that story wires it',
].join('\n');

describe('play declaration — parsing', () => {
  it('reads a required instruction', () => {
    const d = parsePlayDeclarationText(STORY_REQUIRED);
    assert.equal(d.declared, true);
    assert.equal(d.kind, 'required');
    assert.match(d.instruction, /start the slice scene/);
    assert.deepEqual(d.errors, []);
  });

  it('reads a deferral with its reason', () => {
    const d = parsePlayDeclarationText(STORY_DEFERRED);
    assert.equal(d.declared, true);
    assert.equal(d.kind, 'deferred');
    assert.equal(d.deferTo, 'epic-1::story-2.md');
    assert.match(d.reason, /no runtime surface/);
  });

  it('refuses a declaration with no content', () => {
    const d = parsePlayDeclarationText('# Story: x\nPlay:\n');
    assert.equal(d.declared, false);
    assert.equal(d.errors.length, 1);
    assert.match(d.errors[0], /declares nothing/);
  });

  it('refuses a recognised form with no content, rather than accepting the keyword', () => {
    const required = parsePlayDeclarationText('Play: required\n');
    assert.match(required.errors[0], /what the user does/);

    const deferred = parsePlayDeclarationText('Play: deferred to epic-1::story-2.md\n');
    assert.match(deferred.errors[0], /must say WHY/);
  });

  it('refuses an unrecognised form, because an ignored declaration reads as a missing one', () => {
    const d = parsePlayDeclarationText('Play: not applicable — it is only a library\n');
    assert.equal(d.declared, false);
    assert.match(d.errors[0], /unrecognised play declaration/);
  });

  it('ignores a declaration quoted inside a fenced block', () => {
    const text = ['```', 'Play: required — quoted example', '```', 'Play: required — the real one'].join('\n');
    assert.match(parsePlayDeclarationText(text).instruction, /the real one/);
  });
});

describe('play declaration — validation', () => {
  const workItems = {
    refs: new Set(['epic-1::story-1.md', 'epic-1::story-2.md', 'epic-1']),
    status: new Map([['epic-1::story-1.md', 'in-progress'], ['epic-1::story-2.md', 'in-progress']]),
  };

  it('accepts a required declaration: the play itself is the person\'s', () => {
    const d = parsePlayDeclarationText(STORY_REQUIRED);
    const v = validatePlayDeclaration(d, { workItems, self: 'story-1.md' });
    assert.equal(v.ok, true);
    assert.equal(v.code, 'required');
  });

  it('accepts a deferral to a live work item', () => {
    const d = parsePlayDeclarationText(STORY_DEFERRED);
    const v = validatePlayDeclaration(d, { workItems, self: 'story-1.md' });
    assert.equal(v.ok, true);
    assert.equal(v.code, 'deferred');
  });

  it('refuses silence', () => {
    const v = validatePlayDeclaration(parsePlayDeclarationText('# Story: x\n'), { workItems });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'not-declared');
  });

  it('checks the parser first: a malformed declaration is refused as malformed', () => {
    const v = validatePlayDeclaration(parsePlayDeclarationText('Play: required\n'), { workItems });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'malformed');
  });

  it('refuses a deferral to the story itself', () => {
    const d = parsePlayDeclarationText('Play: deferred to story-1.md — later\n');
    const v = validatePlayDeclaration(d, { workItems, self: 'story-1.md' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'deferral-self');
  });

  it('refuses a deferral to a work item that does not exist', () => {
    const d = parsePlayDeclarationText('Play: deferred to epic-9::story-9.md — later\n');
    const v = validatePlayDeclaration(d, { workItems, self: 'story-1.md' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'unknown-target');
  });

  it('refuses a deferral whose owner has landed, because the play can never arrive', () => {
    const done = {
      refs: new Set(['epic-1::story-2.md']),
      status: new Map([['epic-1::story-2.md', 'done']]),
    };
    const d = parsePlayDeclarationText(STORY_DEFERRED);
    const v = validatePlayDeclaration(d, { workItems: done, self: 'story-1.md' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'deferral-target-done');
    assert.match(v.message, /expired/);
  });

  it('says so when there is no state to check a target against, rather than assuming fine', () => {
    const d = parsePlayDeclarationText(STORY_DEFERRED);
    const v = validatePlayDeclaration(d, { workItems: null, self: 'story-1.md' });
    assert.equal(v.ok, true);
    assert.equal(v.code, 'deferred-unchecked');
  });
});

describe('userPlaythroughConfirmed — where it is required', () => {
  it('joins review -> validation when the repository opts in', () => {
    const spec = requiredGates('validation', { userPlay: true });
    assert.equal(spec.from, 'review');
    assert.ok(spec.gates.includes(USER_PLAY_GATE));
    assert.ok(!spec.revalidate.includes(USER_PLAY_GATE), 'a play is not re-demanded at epic closure');
  });

  it('is absent when the repository has not opted in — adopting the version is a no-op', () => {
    const spec = requiredGates('validation', { userPlay: false });
    assert.ok(!spec.gates.includes(USER_PLAY_GATE));
    assert.deepEqual([...spec.gates], [...TRANSITIONS.review.gates]);
  });

  it('does not attach to the next-story loop or to closure', () => {
    for (const phase of ['implementation', 'closed', 'review']) {
      const spec = requiredGates(phase, { userPlay: true });
      if (!spec) continue;
      assert.ok(!spec.gates.includes(USER_PLAY_GATE), `${phase} must not require a playthrough`);
      assert.ok(!(spec.revalidate || []).includes(USER_PLAY_GATE));
    }
  });

  it('is appended to the frozen list, never inserted', () => {
    assert.equal(GATES[GATES.length - 1], USER_PLAY_GATE);
    assert.equal(GATES.length, 13);
  });
});

describe('userPlaythroughConfirmed — the registry contract', () => {
  it('is human-owned, with no automated path and no project command', () => {
    const builder = gateBuilder(USER_PLAY_GATE);
    assert.equal(builder.owner, 'human');
    assert.equal(builder.automatedPath, null);
    assert.equal(builder.projectCommand, false);
    assert.equal(builder.manual, true);
    assert.match(builder.attests, /played the delivered work/);
  });

  it('is listed as manual-only, which is the only route a human-owned gate has', () => {
    assert.ok(MANUAL_ONLY_GATES.includes(USER_PLAY_GATE));
    assert.ok(manualOnlyGateNames().includes(USER_PLAY_GATE));
  });

  it('keeps the registry coherent — the audit the registry test also runs', () => {
    assert.deepEqual(auditGateRegistry(), []);
  });
});

describe('play deferrals — the graph', () => {
  it('reads siblings so a cycle can be seen', () => {
    const siblings = readSiblingPlayDeclarations('E:/definitely/not/a/path/story-1.md', { workItems: null });
    assert.deepEqual(siblings, [], 'an unreadable directory is not this verdict\'s business');
  });

  it('names every gap, one line per finding — the shape the CLI iterates', () => {
    const lines = describePlayGaps({
      validation: { ok: false, message: 'no Play: line' },
      cycles: [['a', 'b', 'a']],
      story: 's.md',
    });
    assert.ok(Array.isArray(lines), 'a joined string iterates its characters, which printed the refusal one letter per line');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /s\.md/);
    assert.match(lines[1], /a → b → a/);
    assert.deepEqual(describePlayGaps({ validation: { ok: true }, cycles: [] }), []);
  });
});
