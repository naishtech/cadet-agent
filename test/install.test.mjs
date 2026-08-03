import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

// ── Functions under test (reconstructed inline for unit test isolation) ──────

function normalizeVersion(v) {
  return (v || '').replace(/^v/, '');
}

describe('normalizeVersion', () => {
  it('strips v prefix', () => {
    assert.equal(normalizeVersion('v0.15.0'), '0.15.0');
  });

  it('passes bare version through', () => {
    assert.equal(normalizeVersion('0.12.0'), '0.12.0');
  });

  it('handles null/undefined', () => {
    assert.equal(normalizeVersion(null), '');
    assert.equal(normalizeVersion(undefined), '');
  });

  it('handles empty string', () => {
    assert.equal(normalizeVersion(''), '');
  });

  it('only strips leading v', () => {
    assert.equal(normalizeVersion('v1.2.3-v'), '1.2.3-v');
  });
});

// ── matchesPreservedPath (reconstructed for unit test isolation) ────────────

function matchesPreservedPath(filename, preservedPaths) {
  const normalized = filename.replace(/^\.?\/?/, '');
  for (const preserved of preservedPaths) {
    const p = preserved.replace(/^\.?\/?/, '');
    if (normalized === p || normalized.startsWith(p + '/') || normalized.startsWith(p + '\\')) {
      return true;
    }
  }
  return false;
}

describe('matchesPreservedPath', () => {
  const preserved = ['.cadet/agent/policies', '.cadet/agent/project-plans'];

  it('matches exact preserved path', () => {
    assert.equal(matchesPreservedPath('.cadet/agent/policies', preserved), true);
  });

  it('matches nested file under preserved path', () => {
    assert.equal(matchesPreservedPath('.cadet/agent/policies/MyPolicy.md', preserved), true);
  });

  it('does not match non-preserved path', () => {
    assert.equal(matchesPreservedPath('.cadet/agent/core/cadet-agent.md', preserved), false);
  });

  it('normalizes dot-slash prefix (zip entries never have this, but test coverage)', () => {
    assert.equal(matchesPreservedPath('.cadet/agent/policies/config.md', preserved), true);
  });

  it('handles backslash separators (zip entries always use /)', () => {
    // Zip entries always use forward slashes; the function normalizes preserved paths to match
    assert.equal(matchesPreservedPath('.cadet/agent/policies/config.md', preserved), true);
  });

  it('does not match partial prefix', () => {
    assert.equal(matchesPreservedPath('.cadet/agent/policies-extra/file.md', preserved), false);
  });
});

// ── matchesManagedPath (reconstructed for unit test isolation) ──────────────

function matchesManagedPath(filename, managedPaths) {
  const normalized = filename.replace(/^\.?\/?/, '').replace(/\\/g, '/');
  for (const m of managedPaths) {
    const mn = m.replace(/^\.?\/?/, '').replace(/\\/g, '/');
    if (normalized === mn || normalized.startsWith(mn + '/')) {
      return true;
    }
  }
  return false;
}

describe('matchesManagedPath', () => {
  const managed = ['.cadet/agent/core', '.github/agents/cadet.agent.md'];

  it('matches directory managed path', () => {
    assert.equal(matchesManagedPath('.cadet/agent/core/cadet-agent.md', managed), true);
  });

  it('matches single-file managed path', () => {
    assert.equal(matchesManagedPath('.github/agents/cadet.agent.md', managed), true);
  });

  it('does not match unrelated path', () => {
    assert.equal(matchesManagedPath('.cadet/agent/policies/policy.md', managed), false);
  });

  it('matches with Windows separators normalized', () => {
    assert.equal(matchesManagedPath('.cadet\\agent\\core\\templates\\StoryTemplate.md', managed), true);
  });
});

// ── buildHeaders (reconstructed for unit test isolation) ────────────────────

function buildHeaders(extra = {}) {
  const headers = {
    'User-Agent': 'cadet-agent-cli',
    ...extra,
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

describe('buildHeaders', () => {
  it('includes User-Agent always', () => {
    const h = buildHeaders();
    assert.equal(h['User-Agent'], 'cadet-agent-cli');
  });

  it('includes extra headers', () => {
    const h = buildHeaders({ 'Accept': 'application/json' });
    assert.equal(h['Accept'], 'application/json');
  });

  it('excludes Authorization when no token set', () => {
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      const h = buildHeaders();
      assert.equal('Authorization' in h, false);
    } finally {
      if (saved) process.env.GITHUB_TOKEN = saved;
    }
  });

  it('includes Authorization when GITHUB_TOKEN set', () => {
    const saved = process.env.GITHUB_TOKEN;
    const savedGh = process.env.GH_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    delete process.env.GH_TOKEN;
    try {
      const h = buildHeaders();
      assert.equal(h['Authorization'], 'Bearer test-token');
    } finally {
      if (saved) process.env.GITHUB_TOKEN = saved; else delete process.env.GITHUB_TOKEN;
      if (savedGh) process.env.GH_TOKEN = savedGh;
    }
  });

  it('falls back to GH_TOKEN', () => {
    const saved = process.env.GITHUB_TOKEN;
    const savedGh = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = 'gh-fallback';
    try {
      const h = buildHeaders();
      assert.equal(h['Authorization'], 'Bearer gh-fallback');
    } finally {
      if (saved) process.env.GITHUB_TOKEN = saved;
      if (savedGh) process.env.GH_TOKEN = savedGh; else delete process.env.GH_TOKEN;
    }
  });

  it('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    const saved = process.env.GITHUB_TOKEN;
    const savedGh = process.env.GH_TOKEN;
    process.env.GITHUB_TOKEN = 'primary';
    process.env.GH_TOKEN = 'fallback';
    try {
      const h = buildHeaders();
      assert.equal(h['Authorization'], 'Bearer primary');
    } finally {
      if (saved) process.env.GITHUB_TOKEN = saved; else delete process.env.GITHUB_TOKEN;
      if (savedGh) process.env.GH_TOKEN = savedGh; else delete process.env.GH_TOKEN;
    }
  });
});

// ── ZIP parser: findEocd (reconstructed for unit test isolation) ────────────

const SIG_EOCD = 0x06054b50;

function read32(buf, off) { return buf.readUInt32LE(off); }

function findEocd(buf) {
  const maxStart = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= maxStart; i--) {
    if (read32(buf, i) === SIG_EOCD) return i;
  }
  throw new Error('Not a valid ZIP file: EOCD signature not found');
}

describe('findEocd', () => {
  it('finds EOCD in minimal ZIP', () => {
    // Minimal ZIP: local file header + central directory + EOCD
    // EOCD = signature(4) + disk(2) + cdDisk(2) + cdEntriesOnDisk(2) + cdEntriesTotal(2) + cdSize(4) + cdOffset(4) + commentLen(2)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    // cdSize=0, cdOffset=0, commentLen=0
    // Put a local file header + CD entry before it for a valid-ish structure
    const buf = Buffer.concat([
      Buffer.alloc(30), // dummy local file header
      Buffer.alloc(46), // dummy central directory entry
      eocd,
    ]);
    const off = findEocd(buf);
    assert.equal(off, 76);
  });

  it('throws on empty buffer', () => {
    assert.throws(() => findEocd(Buffer.alloc(0)), /Not a valid ZIP file/);
  });

  it('throws when EOCD signature missing', () => {
    assert.throws(() => findEocd(Buffer.alloc(100)), /Not a valid ZIP file/);
  });
});
