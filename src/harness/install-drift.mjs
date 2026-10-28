/**
 * Install drift — the record against the disk.
 *
 * The install record (`.cadet/agent/install.json`) lists every file the installer
 * wrote, with its sha256. This module answers two cheap questions the health line
 * needs, and nothing more:
 *
 *   - is anything the install wrote now missing? (stat, every recorded file)
 *   - has the Cadet CLI been edited since it was installed? (hash, CLI files only)
 *
 * The split is deliberate. A missing file is wrong at any moment and costs one
 * stat to find. A modified file is not wrong: a consumer may have patched a
 * script on purpose, and that is the case uninstall reports rather than deletes.
 * Hashing all 400+ installed files on every status call would buy nothing here,
 * because only the CLI feeds a gate-shaped decision — a build fails when its
 * scripts are gone, and a patched script announces itself in the build log.
 *
 * READ-ONLY. Nothing in this file writes.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const INSTALL_RECORD_REL = '.cadet/agent/install.json';

/** The record, or null when this project has none. */
export function readInstallRecordFile(targetDir) {
  try {
    return JSON.parse(readFileSync(join(targetDir, INSTALL_RECORD_REL), 'utf-8'));
  } catch {
    return null;
  }
}

const CLI_COMPONENT = /^engine\.[a-z]+\.cli$/;

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Report what the record says, and what the disk says back.
 *
 * Returns:
 *   installed      — a record exists
 *   suiteVersion   — the version the record was written for
 *   files          — { total, missing } for every recorded file
 *   cli            — { recorded, total, modified, missing } for the CLI files only
 */
export function installDrift(targetDir) {
  const record = readInstallRecordFile(targetDir);
  if (!record) {
    return {
      installed: false,
      suiteVersion: null,
      components: [],
      files: { total: 0, missing: 0 },
      cli: { recorded: false, total: 0, modified: 0, missing: 0 },
    };
  }

  const entries = Array.isArray(record.files) ? record.files : [];
  let missing = 0;
  for (const entry of entries) {
    try {
      if (!statSync(join(targetDir, entry.path)).isFile()) missing += 1;
    } catch {
      missing += 1;
    }
  }

  const cliEntries = entries.filter((e) => CLI_COMPONENT.test(String(e.component || '')));
  let cliMissing = 0;
  let cliModified = 0;
  for (const entry of cliEntries) {
    const full = join(targetDir, entry.path);
    try {
      if (!statSync(full).isFile()) { cliMissing += 1; continue; }
      if (sha256Of(full) !== entry.sha256) cliModified += 1;
    } catch {
      cliMissing += 1;
    }
  }

  return {
    installed: true,
    suiteVersion: record.suiteVersion || null,
    components: Array.isArray(record.components) ? record.components : [],
    files: { total: entries.length, missing },
    cli: { recorded: cliEntries.length > 0, total: cliEntries.length, modified: cliModified, missing: cliMissing },
  };
}
