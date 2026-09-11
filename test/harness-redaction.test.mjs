import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactString, containsSecret, REDACTED, REDACTION_CATEGORIES } from '../src/harness/redaction.mjs';

/** Positive fixtures: one representative value per required category. */
const SECRET_FIXTURES = {
  'auth-header': 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  'private-key': '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  certificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  'openai-key': ['sk', '-', 'abcdefghijklmnopqrstuvwxyz012345'].join(''),
  'anthropic-key': ['sk', '-ant-', 'abcdefghijklmnopqrstuvwxyz012345'].join(''),
  'stripe-key': ['sk', '_live_', 'abcdefghijklmnopqrstuvwx'].join(''),
  'github-token': ['ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''),
  'npm-token': ['npm', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''),
  'aws-access-key': ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  'google-key': ['AIzaSy', 'A1234567890abcdefghijklmnopqrstuv'].join(''),
  'slack-token': ['xoxb', '-123456789012-', 'abcdefghijklm'].join(''),
  'connection-string': 'postgres://user:supersecret@localhost:5432/db',
};

describe('redaction — positive fixtures per category', () => {
  for (const [category, secret] of Object.entries(SECRET_FIXTURES)) {
    it(`redacts ${category}`, () => {
      const out = redactString(`value=${secret} trailing`);
      assert.ok(out.includes(REDACTED), `${category} was not redacted: ${out}`);
      assert.equal(out.includes(secret.split('\n')[0]), false, `${category} leaked: ${out}`);
    });
  }

  it('exposes a regex source for every required category', () => {
    for (const name of Object.keys(SECRET_FIXTURES)) {
      assert.ok(REDACTION_CATEGORIES[name], `missing category regex: ${name}`);
    }
  });
});

describe('redaction — negative fixtures (must pass through)', () => {
  const safeValues = [
    'const total = 42;',
    'Bearer tokens are documented in the security guide.'.replace('Bearer tokens', 'tokens'),
    'the quick brown fox',
    'http://example.com/path',
    'function basic(a, b) { return a + b; }',
    'npm test -- --watch',
    'the password field must be validated',
    'sk- short',
    'version 1.2.3',
  ];
  for (const value of safeValues) {
    it(`does not redact: ${value.slice(0, 40)}`, () => {
      assert.equal(redactString(value), value);
    });
  }
});

describe('redaction — nested structures', () => {
  it('redacts secret-like keys in objects', () => {
    const out = redact({ config: { apiKey: 'abcdef123456', username: 'bob' } });
    assert.equal(out.config.apiKey, REDACTED);
    assert.equal(out.config.username, 'bob');
  });

  it('redacts secrets nested in arrays', () => {
    const out = redact({ headers: ['Accept: json', 'Authorization: Bearer abcdefghijklmnop'] });
    assert.equal(out.headers[0], 'Accept: json');
    assert.ok(out.headers[1].includes(REDACTED));
  });

  it('redacts deeply nested secret keys', () => {
    const out = redact({ a: { b: { c: { password: 'hunter2', keep: 'this' } } } });
    assert.equal(out.a.b.c.password, REDACTED);
    assert.equal(out.a.b.c.keep, 'this');
  });

  it('does not crash on nulls and primitives', () => {
    assert.equal(redact(null), null);
    assert.equal(redact(42), 42);
    assert.equal(redact({ token: null }).token, null);
  });

  it('detects secret-shaped content without returning it', () => {
    assert.equal(containsSecret({ password: 'hunter2' }), true);
    assert.equal(containsSecret({ username: 'bob' }), false);
  });
});
