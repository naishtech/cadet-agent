import { unlinkSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Path helpers ────────────────────────────────────────────────────────────

function walkDir(dir, fn) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fn);
    } else {
      fn(fullPath);
    }
  }
}

function deletePath(targetDir, relativePath) {
  const norm = relativePath.replace(/^\.\//, '').replace(/\\/g, '/');
  const fullPath = join(targetDir, norm);
  let st;
  try { st = statSync(fullPath); } catch { return []; }

  const deleted = [];
  if (st.isFile()) {
    try { unlinkSync(fullPath); deleted.push(fullPath); } catch {}
  } else if (st.isDirectory()) {
    walkDir(fullPath, (filePath) => {
      try { unlinkSync(filePath); deleted.push(filePath); } catch {}
    });
  }
  return deleted;
}

// ── Upgrade registry ────────────────────────────────────────────────────────

// Add upgrade entries when removing/renaming managed paths.
// Key = FROM version. Example:
//   '0.17.0': (targetDir) => [
//     ...deletePath(targetDir, '.cadet/some-old-dir'),
//     ...deletePath(targetDir, '.github/old-agent.agent.md'),
//   ],

const upgrades = {};

// ── Runner ──────────────────────────────────────────────────────────────────

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export function runUpgrades(targetDir, fromVersion, toVersion) {
  const deleted = [];

  for (const [ver, fn] of Object.entries(upgrades)) {
    if (semverGt(ver, fromVersion) && !semverGt(ver, toVersion)) {
      try {
        const result = fn(targetDir);
        if (Array.isArray(result)) deleted.push(...result);
      } catch {
        // Upgrade failure shouldn't block the sync
      }
    }
  }

  return deleted;
}
