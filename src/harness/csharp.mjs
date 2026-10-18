/**
 * C# structure scan for the component-diagram generator.
 *
 * A "package" is a Unity assembly definition (`.asmdef`) — the assembly is the
 * unit a C# project is actually built and referenced in. A "component" is a
 * namespace inside a package: the right granularity for a package-level diagram,
 * where listing types would overflow the page.
 *
 * The scan is deliberately tolerant. A repository with no `.asmdef` files still
 * gets packages (its top-level folders), because the generator must work on a
 * plain C# tree and on this framework source itself, where it is run for its
 * structure alone.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';

/** Directory names never walked: build output, caches, and Cadet's own bookkeeping. */
export const DEFAULT_EXCLUDED_DIRS = Object.freeze([
  'node_modules', '.git', '.vs', '.idea', '.cadet',
  'Library', 'Temp', 'obj', 'bin', 'Logs', 'UserSettings', 'Build', 'Builds', 'MemoryCaptures',
]);

function toPosix(path) {
  return String(path).replace(/\\/g, '/');
}

function isInside(child, parent) {
  const c = toPosix(child);
  const p = toPosix(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Every file under `rootDir`, skipping excluded directory names. */
function walkFiles(rootDir, excluded) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  visit(rootDir);
  return out;
}

/** The GUID recorded in an `.asmdef.meta`, so `GUID:` references can be resolved. */
function readMetaGuid(asmdefPath) {
  try {
    const text = readFileSync(`${asmdefPath}.meta`, 'utf-8');
    const m = /guid:\s*([0-9a-fA-F]{32})/.exec(text);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Discover packages under `rootDir`.
 *
 * Returns `{ id, name, dir, asmdefPath, references }`, sorted by id. `references`
 * names the packages this one depends on; a reference Unity stored as a GUID is
 * resolved through the `.asmdef.meta`, and one it stored by name through the
 * assembly name.
 */
export function scanPackages(rootDir, { exclude = DEFAULT_EXCLUDED_DIRS } = {}) {
  const excluded = new Set(exclude);
  const files = walkFiles(rootDir, excluded);

  const byDir = new Map();
  const byName = new Map();
  const byGuid = new Map();

  for (const asmdefPath of files.filter((f) => f.endsWith('.asmdef'))) {
    let json;
    try {
      json = JSON.parse(readFileSync(asmdefPath, 'utf-8'));
    } catch {
      // A malformed asmdef is still a package boundary; fall back to its folder.
      json = {};
    }
    const dir = dirname(asmdefPath);
    const name = typeof json.name === 'string' && json.name ? json.name : basename(dir);
    const declaredReferences = Array.isArray(json.references)
      ? json.references.filter((r) => typeof r === 'string')
      : [];
    const precompiled = Array.isArray(json.precompiledReferences)
      ? json.precompiledReferences.filter((r) => typeof r === 'string')
      : [];
    const optional = Array.isArray(json.optionalUnityReferences) ? json.optionalUnityReferences : [];
    const pkg = {
      id: toPosix(name),
      name,
      dir,
      asmdefPath,
      // A Unity test assembly, recognised by what it references rather than by
      // its name. Projects name test assemblies inconsistently, but a test
      // assembly must reference the TestRunner or nunit to run under the Unity
      // Test Framework, so that is the reliable signal.
      isTest: optional.includes('TestAssemblies')
        || declaredReferences.includes('UnityEngine.TestRunner')
        || declaredReferences.includes('UnityEditor.TestRunner')
        || precompiled.includes('nunit.framework.dll'),
      rawReferences: declaredReferences,
      references: [],
    };
    byDir.set(dir, pkg);
    byName.set(name, pkg);
    const guid = readMetaGuid(asmdefPath);
    if (guid) byGuid.set(guid, pkg);
  }

  if (byDir.size === 0) return fallbackPackages(rootDir, files);

  for (const pkg of byDir.values()) {
    const resolved = [];
    for (const ref of pkg.rawReferences) {
      const target = ref.startsWith('GUID:')
        ? byGuid.get(ref.slice(5).toLowerCase())
        : byName.get(ref);
      if (target && target.dir !== pkg.dir) resolved.push(target.id);
    }
    pkg.references = [...new Set(resolved)].sort();
    delete pkg.rawReferences;
  }

  return [...byDir.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** No `.asmdef` anywhere: each top-level folder that holds C# becomes a package. */
function fallbackPackages(rootDir, files) {
  const groups = new Map();
  for (const file of files.filter((f) => f.endsWith('.cs'))) {
    const parts = toPosix(relative(rootDir, file)).split('/');
    const key = parts.length > 1 ? parts[0] : '(root)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return [...groups.keys()].sort().map((name) => ({
    id: toPosix(name),
    name,
    dir: name === '(root)' ? rootDir : join(rootDir, name),
    asmdefPath: null,
    isTest: false,
    references: [],
  }));
}

/**
 * The `.cs` files that belong to a package: those under its directory and not
 * under a deeper package's directory. Unity nests assemblies, so a file's
 * owning assembly is its nearest ancestor `.asmdef`.
 */
function filesForPackage(pkg, packages, excluded) {
  const nested = packages
    .filter((p) => p.dir !== pkg.dir && isInside(p.dir, pkg.dir))
    .map((p) => p.dir);
  return walkFiles(pkg.dir, excluded)
    .filter((f) => f.endsWith('.cs'))
    .filter((f) => !nested.some((dir) => isInside(dirname(f), dir)))
    .sort();
}

/** The file's declared namespace, or null when it declares none. */
function readNamespace(file) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const m = /^\s*namespace\s+([A-Za-z_][\w.]*)/m.exec(text);
  return m ? m[1] : null;
}

/**
 * Group a package's files into components by namespace, falling back to the
 * containing folder for files that declare none. Sorted by id for determinism.
 */
export function scanComponents(pkg, { packages = [pkg], exclude = DEFAULT_EXCLUDED_DIRS } = {}) {
  const excluded = new Set(exclude);
  const groups = new Map();
  for (const file of filesForPackage(pkg, packages, excluded)) {
    const namespace = readNamespace(file);
    const key = namespace || toPosix(relative(pkg.dir, dirname(file))) || '(root)';
    if (!groups.has(key)) groups.set(key, { namespace, files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      id: toPosix(key),
      name: key,
      namespace: group.namespace,
      files: group.files.sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Best-effort component dependencies from `using` directives.
 *
 * A `using` names a namespace, which is matched to the longest component
 * namespace that is a PREFIX of it: `using A.B.C` maps to a component `A.B` (or
 * `A.B.C` when that exists), because a namespace nested deeper is a different
 * component. The reverse match was a bug the real-project test caught: with both
 * `Dolven.Game.Rendering` and `Dolven.Game.Rendering.Crowd` present, a plain
 * `using Dolven.Game.Rendering;` was attributed to the longer `…Crowd` sibling.
 *
 * This is an approximation by design: it reads declarations, not the compiled
 * type graph, and it says so in the docs.
 */
export function componentEdges(components) {
  const byNamespace = new Map(components.filter((c) => c.namespace).map((c) => [c.namespace, c.id]));
  const namespaces = [...byNamespace.keys()];

  const resolve = (ns) => {
    let best = null;
    for (const candidate of namespaces) {
      if (ns === candidate || ns.startsWith(`${candidate}.`)) {
        if (!best || candidate.length > best.length) best = candidate;
      }
    }
    return best ? byNamespace.get(best) : null;
  };

  const edges = new Map();
  const usingRe = /^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm;
  for (const component of components) {
    for (const file of component.files) {
      let text;
      try {
        text = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      usingRe.lastIndex = 0;
      let m;
      while ((m = usingRe.exec(text)) !== null) {
        const target = resolve(m[1]);
        if (target && target !== component.id) {
          edges.set(`${component.id}\u0000${target}`, { from: component.id, to: target, kind: 'uses' });
        }
      }
    }
  }
  return [...edges.values()].sort((a, b) => `${a.from}\u0000${a.to}`.localeCompare(`${b.from}\u0000${b.to}`));
}

export { toPosix };
