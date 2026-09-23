import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  encodeEvidenceTrailers, parseEvidenceTrailers, sealedEvidence, latestSealedForGate,
  coverageFromSealed, DEFAULT_MAX_TRAILER_BYTES,
} from '../src/harness/gitmemo.mjs';

/**
 * A record shaped exactly like the ones the harness writes, including the
 * null-valued keys, so a round trip is compared against the real thing rather
 * than a convenient subset.
 */
function record(overrides = {}) {
  return {
    evidenceId: 'eae0a0e4-1ede-4cc7-a401-9c5a06912050',
    workItemId: 'epic-2-world-map-movement::story-3-derive-grid-from-authored-map.md',
    acceptanceCriterionId: null,
    phase: 'implementation',
    gate: 'testsPassed',
    status: 'passed',
    command: 'bash ./test-gate.sh',
    result: 'exit 0',
    exitCode: 0,
    artifactPath: null,
    artifactHash: null,
    inputTreeHash: '8e7f1f1fe4525187c6df9279d7bde53354504e9014b366488105009ed84158fe',
    criteriaHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    relevantFiles: ['Assets/Scripts/Sim/IMapSource.cs', 'Assets/Scripts/Sim/MapLoader.cs'],
    toolVersion: null,
    createdAt: '2026-09-13T06:28:31.248Z',
    expiresAt: null,
    freshnessPolicy: { scope: 'story' },
    supersededBy: null,
    source: 'automated',
    ...overrides,
  };
}

/** Build the `git log --format=%H%x00%B%x00` output a real run would produce. */
function gitLogOutput(commits) {
  return commits.map(({ sha, message }) => `${sha}\0${message}\0`).join('');
}

/** A runner stub that answers `git log` with fixed bytes and nothing else. */
function stubRunner({ stdout = '', status = 0, stderr = '' } = {}) {
  return () => ({ status, stdout, stderr, error: null });
}

describe('git evidence — trailer codec', () => {
  it('round-trips every field of an evidence record', () => {
    const original = record();
    const { lines } = encodeEvidenceTrailers(original);
    const { records, diagnostics } = parseEvidenceTrailers(`subject line\n\n${lines.join('\n')}`);

    assert.deepEqual(diagnostics, []);
    assert.equal(records.length, 1);
    // `commit` is the one field not encoded: the commit that carries the trailer
    // IS the citation, so writing it into the message would be self-referential.
    for (const key of Object.keys(original)) {
      assert.deepEqual(records[0][key], original[key], `field ${key} did not survive the round trip`);
    }
  });

  it('preserves key presence for the fields the contract requires to be present', () => {
    // `command` and `result` may be null but must EXIST, and a freshness bound
    // must be declared. A codec that dropped the key instead of the value would
    // turn a valid record into an invalid one on the way back.
    const { lines } = encodeEvidenceTrailers(record({ command: null, result: null }));
    const parsed = parseEvidenceTrailers(lines.join('\n')).records[0];
    assert.ok('command' in parsed, 'command key must survive as null');
    assert.ok('result' in parsed, 'result key must survive as null');
    assert.ok('expiresAt' in parsed, 'the declared freshness bound must survive');
    assert.equal(parsed.command, null);
  });

  it('parses several gate blocks out of one commit message', () => {
    const a = encodeEvidenceTrailers(record({ gate: 'testsPassed' })).lines;
    const b = encodeEvidenceTrailers(record({ gate: 'codeReviewCompleted' })).lines;
    const { records } = parseEvidenceTrailers(`subject\n\n${a.join('\n')}\n\n${b.join('\n')}\n`);
    assert.deepEqual(records.map((r) => r.gate), ['testsPassed', 'codeReviewCompleted']);
  });

  it('keeps values that would otherwise break a line-oriented format', () => {
    // Each of these has broken a naive "key: value" format at some point: a
    // newline ends the trailer, a leading `"` looks like an encoded value, the
    // literal text `null` is indistinguishable from absence, and a comma inside a
    // file name would be mistaken for a list separator.
    const original = record({
      command: 'node -e "a\nb"',
      result: 'null',
      reason: '"quoted"',
      relevantFiles: ['weird,name.cs', 'normal.cs'],
      scope: ['a,b'],
    });
    const { lines } = encodeEvidenceTrailers(original);
    assert.equal(lines.some((l) => l.includes('\n')), false, 'no trailer may carry a raw newline');

    const parsed = parseEvidenceTrailers(lines.join('\n')).records[0];
    assert.equal(parsed.command, original.command);
    assert.equal(parsed.result, 'null', 'the string "null" must not decode as absence');
    assert.equal(parsed.reason, '"quoted"');
    assert.deepEqual(parsed.relevantFiles, ['weird,name.cs', 'normal.cs']);
    assert.deepEqual(parsed.scope, ['a,b']);
  });

  it('reports unknown trailers instead of silently ignoring them', () => {
    // A typo in a trailer name would otherwise look like a complete record that
    // simply carries nothing — the failure mode where a claim reads as verified.
    const { records, diagnostics } = parseEvidenceTrailers('Cadet-Gate: testsPassed\nCadet-Typo: x\n');
    assert.equal(records.length, 1);
    assert.ok(diagnostics.some((d) => /unknown trailer "Cadet-Typo"/.test(d)), JSON.stringify(diagnostics));
  });

  it('tolerates human prose between and around the trailers', () => {
    const { lines } = encodeEvidenceTrailers(record());
    const message = `feat: do the thing\n\nSome explanation for a reviewer.\n\nSigned-off-by: someone\n\n${lines.join('\n')}\n`;
    const { records, diagnostics } = parseEvidenceTrailers(message);
    assert.equal(records.length, 1);
    assert.deepEqual(diagnostics, []);
    assert.equal(records[0].gate, 'testsPassed');
  });

  it('bounds the block and marks it partial rather than emitting a mangled line', () => {
    const big = record({ relevantFiles: Array.from({ length: 400 }, (_, i) => `Assets/Very/Long/Segment/File${i}.cs`) });
    const encoded = encodeEvidenceTrailers(big, { maxBytes: 4096 });
    assert.equal(encoded.partial, true);
    assert.ok(encoded.bytes <= 4096, `block was ${encoded.bytes} bytes, over the 4096 bound`);

    const parsed = parseEvidenceTrailers(encoded.lines.join('\n')).records[0];
    assert.equal(parsed.partial, true, 'a truncated record must say so — otherwise it reads as binding every file');
    assert.ok(parsed.relevantFiles.length < 400);
  });

  it('does not mark an ordinary record partial', () => {
    const encoded = encodeEvidenceTrailers(record());
    assert.equal(encoded.partial, false);
    assert.ok(encoded.bytes < DEFAULT_MAX_TRAILER_BYTES);
  });
});

describe('git evidence — reading sealed history', () => {
  it('fails safe when git is unavailable, rather than reporting no evidence', () => {
    // The distinction matters: "no sealed evidence" is a finding about the
    // repository, while "could not ask" is a finding about the environment. Only
    // the first may be treated as an absence of proof.
    const unavailable = sealedEvidence('/nowhere', { runner: () => null });
    assert.equal(unavailable.available, false);
    assert.match(unavailable.reason, /not available/);
    assert.deepEqual(unavailable.records, []);

    const notARepo = sealedEvidence('/nowhere', { runner: stubRunner({ status: 128, stderr: 'fatal: not a git repository' }) });
    assert.equal(notARepo.available, false);
    assert.match(notARepo.reason, /not a git repository/);
  });

  it('reads records back out of git log output and stamps each with its commit', () => {
    const sha = 'a'.repeat(40);
    const stdout = gitLogOutput([{ sha, message: `feat: x\n\n${encodeEvidenceTrailers(record()).lines.join('\n')}\n` }]);
    const result = sealedEvidence('/repo', { runner: stubRunner({ stdout }) });
    assert.equal(result.available, true);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].sealedCommit, sha);
    assert.equal(result.records[0].gate, 'testsPassed');
  });

  it('filters by work item and gate', () => {
    const stdout = gitLogOutput([
      { sha: 'a'.repeat(40), message: `${encodeEvidenceTrailers(record({ gate: 'testsPassed' })).lines.join('\n')}\n` },
      { sha: 'b'.repeat(40), message: `${encodeEvidenceTrailers(record({ gate: 'codeReviewCompleted' })).lines.join('\n')}\n` },
      { sha: 'c'.repeat(40), message: `${encodeEvidenceTrailers(record({ gate: 'testsPassed', workItemId: 'other::story.md' })).lines.join('\n')}\n` },
    ]);
    const runner = stubRunner({ stdout });
    assert.equal(sealedEvidence('/repo', { runner, gate: 'testsPassed' }).records.length, 2);
    assert.equal(sealedEvidence('/repo', { runner, workItemId: record().workItemId }).records.length, 2);
    assert.equal(sealedEvidence('/repo', { runner, workItemId: record().workItemId, gate: 'testsPassed' }).records.length, 1);
  });

  it('picks the newest sealed record for a gate', () => {
    const stdout = gitLogOutput([
      { sha: 'a'.repeat(40), message: `${encodeEvidenceTrailers(record({ createdAt: '2026-09-01T00:00:00.000Z' })).lines.join('\n')}\n` },
      { sha: 'b'.repeat(40), message: `${encodeEvidenceTrailers(record({ createdAt: '2026-09-20T00:00:00.000Z' })).lines.join('\n')}\n` },
    ]);
    const result = latestSealedForGate('/repo', { runner: stubRunner({ stdout }), gate: 'testsPassed' });
    assert.equal(result.record.createdAt, '2026-09-20T00:00:00.000Z');
    assert.equal(result.record.sealedCommit, 'b'.repeat(40));
  });

  it('builds coverage rows from sealed history without needing the state document', () => {
    const stdout = gitLogOutput([
      { sha: 'a'.repeat(40), message: `${encodeEvidenceTrailers(record({ gate: 'testsPassed' })).lines.join('\n')}\n` },
      { sha: 'b'.repeat(40), message: `${encodeEvidenceTrailers(record({ gate: 'codeReviewCompleted' })).lines.join('\n')}\n` },
    ]);
    const { coverage } = coverageFromSealed('/repo', { runner: stubRunner({ stdout }) });
    const row = coverage[record().workItemId];
    assert.equal(row.recordCount, 2);
    assert.deepEqual(row.gates, ['codeReviewCompleted', 'testsPassed']);
  });
});

describe('git evidence — real repository round trip', () => {
  it('seals into a commit and reads the record back through git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-gitmemo-'));
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8', windowsHide: true });
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
      g(['init', '-q', '.']);
      g(['config', 'user.email', 't@t.t']);
      g(['config', 'user.name', 't']);
      g(['add', '-A']);
      g(['commit', '-qm', 'init']);

      const original = record();
      const message = `feat: derive grid\n\n${encodeEvidenceTrailers(original).lines.join('\n')}\n`;
      // Written to a file and passed via -F, which is exactly how `state seal`
      // hands the prepared message to the user's commit.
      writeFileSync(join(dir, 'msg.txt'), message);
      g(['commit', '--allow-empty', '-q', '-F', 'msg.txt']);

      const result = sealedEvidence(dir, { workItemId: original.workItemId, gate: 'testsPassed' });
      assert.equal(result.available, true, result.reason);
      assert.equal(result.records.length, 1, 'the trailer block must survive a real commit');

      const sealed = result.records[0];
      assert.equal(sealed.evidenceId, original.evidenceId);
      assert.equal(sealed.inputTreeHash, original.inputTreeHash);
      assert.deepEqual(sealed.relevantFiles, original.relevantFiles);
      assert.match(sealed.sealedCommit, /^[0-9a-f]{40}$/);
      assert.equal(sealed.sealedCommit, g(['rev-parse', 'HEAD']).stdout.trim());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a trailer edit changes the commit id, which is what makes a seal verifiable', () => {
    // This is the property that justifies trailers over notes: the record is
    // inside the object the SHA is computed over, so it cannot be altered after
    // the fact without the citation stopping resolving.
    const dir = mkdtempSync(join(tmpdir(), 'cadet-gitmemo-tamper-'));
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8', windowsHide: true });
    try {
      g(['init', '-q', '.']);
      g(['config', 'user.email', 't@t.t']);
      g(['config', 'user.name', 't']);
      const sealed = encodeEvidenceTrailers(record()).lines.join('\n');
      writeFileSync(join(dir, 'a.txt'), 'x');
      g(['add', '-A']);
      writeFileSync(join(dir, 'm1.txt'), `subject\n\n${sealed}\n`);
      g(['commit', '-q', '-F', 'm1.txt']);
      const first = g(['rev-parse', 'HEAD']).stdout.trim();

      // Same tree contents, one altered byte in the evidence block.
      writeFileSync(join(dir, 'm2.txt'), `subject\n\n${sealed.replace('Cadet-Status: passed', 'Cadet-Status: passedX')}\n`);
      g(['commit', '--allow-empty', '-q', '-F', 'm2.txt']);
      const second = g(['rev-parse', 'HEAD']).stdout.trim();

      assert.notEqual(first, second, 'altering a trailer must change the commit id');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
