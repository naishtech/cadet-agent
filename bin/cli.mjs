#!/usr/bin/env node

import { run } from '../src/cli.mjs';

run(process.argv).catch((err) => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});
