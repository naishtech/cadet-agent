/**
 * Structural validation of the shipped profile fixtures.
 *
 * Not a JSON-Schema engine. It checks the fields the schema marks required, at the
 * top level and inside each platform block, which is the drift this gate exists to
 * catch: a fixture that stops matching the schema, or a schema that stops
 * requiring a field the fixtures rely on.
 *
 * A file named `invalid-*` must FAIL these checks. That is the negative case: the
 * gate is only worth something if it can reject a profile that is missing a
 * required field.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const cliRoot = join(here, '..');
const schema = JSON.parse(readFileSync(join(cliRoot, 'cadet-profile.schema.json'), 'utf-8'));
const fixtureDir = join(cliRoot, 'fixtures', 'profiles');

const missing = (object, required = []) => required.filter((key) => object?.[key] === undefined);

const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('  FAIL  no profile fixtures found');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(fixtureDir, file), 'utf-8'));
  const expectInvalid = file.startsWith('invalid-');

  const errors = missing(doc, schema.required || []);
  for (const block of ['unity', 'unreal', 'steam', 'epic']) {
    if (doc[block] === undefined) continue;
    for (const key of missing(doc[block], schema.properties?.[block]?.required || [])) {
      errors.push(`${block}.${key}`);
    }
  }

  const valid = errors.length === 0;
  if (valid !== !expectInvalid) {
    failures += 1;
    const why = expectInvalid ? 'expected to be invalid, but it passed' : errors.join(', ');
    console.log(`  FAIL  ${file} — ${why}`);
  } else {
    console.log(`  PASS  ${file}${expectInvalid ? ' (rejected, as intended)' : ''}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
