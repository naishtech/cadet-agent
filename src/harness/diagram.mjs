/**
 * Component-diagram model, UML source, and HTML navigation.
 *
 * One diagram is produced per (package × epic). The diagram is scoped to the
 * components that epic's work touched, plus their one-hop dependencies, so a
 * package with many namespaces still yields a small, relevant picture. Anything
 * left out is reported as an elision marker rather than silently dropped.
 *
 * Progress is derived from the framework's own record: a component is coloured by
 * the stories of that epic whose evidence `relevantFiles` land in it. That keeps
 * the diagram tied to the evidence that satisfied the gates, not to a separate
 * hand-maintained map.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { scanPackages, scanComponents, componentEdges, toPosix } from './csharp.mjs';
import { renderSvg } from './noml.mjs';

/** Where the generated tree lands, relative to the target repository. */
export const DIAGRAM_OUT_DIR = '.cadet/diagrams';

/** Records the files a run wrote, so the next run can prune only its own output. */
export const DIAGRAM_MANIFEST = '.diagrams-manifest.json';

/** The three progress states and their colours, as specified. */
export const STATUS_COLORS = Object.freeze({
  'not-started': '#E05555',
  'in-progress': '#E8A840',
  done: '#4A9A5A',
});

/** nomnoml classifier-style names, one per status. */
export const STATUS_CLASS = Object.freeze({
  'not-started': 'notstarted',
  'in-progress': 'inprogress',
  done: 'done',
});

const PNG = Object.freeze({ 'not-started': 'not started', 'in-progress': 'in progress', done: 'done' });

function rel(rootDir, path) {
  return toPosix(relative(rootDir, path));
}

/** A filesystem-safe name for a package id or epic id used as a path segment. */
function safeName(value) {
  const s = String(value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 100);
  return s || 'unnamed';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** A display name safe to embed inside a nomnoml `[...]` node. */
function nomlName(value) {
  return String(value).replace(/[[\]|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim() || 'unnamed';
}

/**
 * Deterministic, nomnoml-safe node ids, one per component.
 *
 * A node rendered as `[<done id=c3> Name]` carries `data-name="c3"` in the SVG
 * — nomnoml sets the node group's data-name to the id — which is what lets a box
 * be made clickable without parsing the diagram's geometry. Edges must reference
 * the id too: a plain `[Name]` reference would be a different node to nomnoml,
 * and it would draw a duplicate box.
 */
function nomlIds(model) {
  const ids = new Map();
  [...model.components].sort((a, b) => a.id.localeCompare(b.id)).forEach((c, i) => ids.set(c.id, `c${i}`));
  return ids;
}

/** Readable, unique file slugs for component pages, assigned in sorted order. */
export function componentSlugs(components) {
  const used = new Set();
  const out = new Map();
  for (const c of [...components].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = c.id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'component';
    let slug = base;
    let n = 2;
    while (used.has(slug.toLowerCase())) slug = `${base}-${n++}`;
    used.add(slug.toLowerCase());
    out.set(c.id, slug);
  }
  return out;
}

/**
 * The types a component declares, best-effort, read from its files.
 *
 * A declaration must START the line (after whitespace and modifiers) and name a
 * PascalCase identifier. That shape is what keeps the word "record" in a comment
 * from being read as a `record` declaration — a false positive a real project
 * produced, listing types literally called "and" and "the".
 *
 * This is still a text scan and not a parse, and the docs say so: an unusual
 * style (a lowercase type name) is missed rather than guessed at.
 */
const TYPE_RE = /^[ \t]*(?:(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|unsafe|ref|file)\s+)*(class|struct|interface|enum|record)\s+(?:class\s+|struct\s+)?([A-Z]\w*)/gm;

function parseTypes(files) {
  const types = [];
  const seen = new Set();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    TYPE_RE.lastIndex = 0;
    let m;
    while ((m = TYPE_RE.exec(text)) !== null) {
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      types.push({ kind: m[1], name: m[2], file: toPosix(file) });
    }
  }
  return types.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Evidence files per work item: inline records first, then the archive.
 *
 * The archive matters because a closed work item's evidence leaves `state.json`
 * (contract v5); without reading it, a finished story would look like it touched
 * nothing and its components would read red.
 */
export function collectWorkItemFiles(rootDir, state) {
  const byItem = new Map();
  const add = (workItemId, files) => {
    if (!workItemId || !Array.isArray(files)) return;
    if (!byItem.has(workItemId)) byItem.set(workItemId, new Set());
    const set = byItem.get(workItemId);
    for (const file of files) if (typeof file === 'string' && file) set.add(toPosix(file));
  };

  for (const record of Array.isArray(state?.gateEvidence) ? state.gateEvidence : []) {
    add(record?.workItemId, record?.relevantFiles);
  }
  for (const record of readArchivedEvidence(rootDir)) add(record?.workItemId, record?.relevantFiles);
  return byItem;
}

function readArchivedEvidence(rootDir) {
  const dir = join(rootDir, '.cadet', 'archive', 'evidence');
  if (!existsSync(dir)) return [];
  const records = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    let text;
    try {
      text = readFileSync(join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // Append-only log: a malformed line is skipped, not fatal.
      }
    }
  }
  return records;
}

/** Scan every package once: its components, the component edges, and a file → owner index. */
export function indexComponents(rootDir, packages) {
  const byFile = new Map();
  const componentsByPkg = new Map();
  const edgesByPkg = new Map();
  for (const pkg of packages) {
    const components = scanComponents(pkg, { packages });
    componentsByPkg.set(pkg.id, components);
    edgesByPkg.set(pkg.id, componentEdges(components));
    for (const component of components) {
      for (const file of component.files) {
        byFile.set(rel(rootDir, file), { packageId: pkg.id, componentId: component.id });
      }
    }
  }
  return { byFile, componentsByPkg, edgesByPkg };
}

function externalOf(pkg, allPackages) {
  const byId = new Map(allPackages.map((p) => [p.id, p.name]));
  return (pkg.references || []).map((id) => ({ id, name: byId.get(id) || id }));
}

function statusFromStatuses(statuses) {
  if (!statuses || statuses.length === 0) return 'not-started';
  return statuses.every((s) => s === 'done') ? 'done' : 'in-progress';
}

/**
 * The work items that touched each component, from every epic.
 *
 * Cumulative on purpose: a component that is finished is green. Deriving the
 * status from only the current epic made a built component read red in a later
 * epic's diagram — measured on a real project, where one component was green in
 * one epic and red in the next. The epic still decides what a diagram SHOWS; it
 * does not decide the colour.
 *
 * Keyed by `<packageId>::<componentId>`; the value is a Map of work-item id to
 * `{ epicId, storyId, status }`, so a component page can name the stories behind
 * a component and not only its colour.
 */
export function componentWorkMap({ state, byFile, workItemFiles }) {
  const byComponent = new Map();
  const epics = state?.epics && typeof state.epics === 'object' ? state.epics : {};
  for (const [epicId, epic] of Object.entries(epics)) {
    const stories = epic?.stories && typeof epic.stories === 'object' ? epic.stories : {};
    for (const [storyFile, status] of Object.entries(stories)) {
      const files = workItemFiles.get(`${epicId}::${storyFile}`);
      if (!files) continue;
      for (const file of files) {
        const owner = byFile.get(toPosix(file));
        if (!owner) continue;
        const key = `${owner.packageId}::${owner.componentId}`;
        if (!byComponent.has(key)) byComponent.set(key, new Map());
        byComponent.get(key).set(`${epicId}::${storyFile}`, { epicId, storyId: storyFile, status });
      }
    }
  }
  return byComponent;
}

/** Every component's status, derived from the work that touched it. */
export function statusesFromWork(work) {
  const statuses = new Map();
  for (const [key, items] of work) {
    statuses.set(key, statusFromStatuses([...items.values()].map((w) => w.status)));
  }
  return statuses;
}

/** Convenience: the work map and the status map together. */
export function componentStatusMap(args) {
  return statusesFromWork(componentWorkMap(args));
}

function makeModel({ pkg, epicId, epicStatus, components, edges, included, statusByKey, allPackages }) {
  const inScope = components.filter((c) => included.has(c.id));
  const elided = components.filter((c) => !included.has(c.id));
  return {
    package: { id: pkg.id, name: pkg.name, asmdefPath: pkg.asmdefPath ? toPosix(pkg.asmdefPath) : null },
    epic: { id: epicId, status: epicStatus },
    components: inScope.map((c) => ({
      id: c.id,
      name: c.name,
      namespace: c.namespace,
      status: statusByKey.get(`${pkg.id}::${c.id}`) || 'not-started',
      files: c.files.map((f) => toPosix(f)),
    })),
    edges: edges.filter((e) => included.has(e.from) && included.has(e.to)),
    external: externalOf(pkg, allPackages),
    elided: { count: elided.length, names: elided.map((c) => c.name).sort() },
    legend: { ...STATUS_COLORS },
  };
}

/**
 * The model for one (package × epic), scoped to touched components + one hop.
 * Returns a model with no components when the epic touched nothing in the package,
 * which the caller reads as "do not emit a diagram".
 */
export function buildDiagramModel({ pkg, epicId, state, components, edges, byFile, workItemFiles, allPackages, componentStatus = null }) {
  const epic = state?.epics?.[epicId] || null;
  const stories = epic?.stories && typeof epic.stories === 'object' ? epic.stories : {};

  // Scope is this epic's work: the components its stories touched.
  const touched = new Set();
  for (const storyFile of Object.keys(stories)) {
    const files = workItemFiles.get(`${epicId}::${storyFile}`);
    if (!files) continue;
    for (const file of files) {
      const owner = byFile.get(toPosix(file));
      if (owner && owner.packageId === pkg.id) touched.add(owner.componentId);
    }
  }

  // Exactly one hop: neighbours of the touched set, computed before anything is
  // added to it, so a chain of three is not pulled in by transitivity.
  const oneHop = new Set();
  for (const edge of edges) {
    if (touched.has(edge.from)) oneHop.add(edge.to);
    if (touched.has(edge.to)) oneHop.add(edge.from);
  }
  const included = new Set([...touched, ...oneHop]);
  const statusByKey = componentStatus || componentStatusMap({ state, byFile, workItemFiles });

  return makeModel({ pkg, epicId, epicStatus: epic?.status || 'planned', components, edges, included, statusByKey, allPackages });
}

/** Structure-only model: every component shown, every one "not started". */
export function buildStructureModel({ pkg, components, edges, allPackages }) {
  const included = new Set(components.map((c) => c.id));
  return makeModel({
    pkg,
    epicId: 'structure',
    epicStatus: 'planned',
    components,
    edges,
    included,
    statusByKey: new Map(),
    allPackages,
  });
}

/** The UML artifact: deterministic nomnoml source for a model. */
export function renderNoml(model) {
  const ids = nomlIds(model);
  const lines = [
    '#direction: right',
    `#.${STATUS_CLASS['not-started']}: fill=${STATUS_COLORS['not-started']}`,
    `#.${STATUS_CLASS['in-progress']}: fill=${STATUS_COLORS['in-progress']}`,
    `#.${STATUS_CLASS.done}: fill=${STATUS_COLORS.done}`,
    `[<frame>${nomlName(model.package.name)}|`,
  ];
  for (const component of [...model.components].sort((a, b) => a.id.localeCompare(b.id))) {
    const name = nomlName(component.namespace || component.name);
    lines.push(`  [<${STATUS_CLASS[component.status]} id=${ids.get(component.id)}> ${name}]`);
  }
  for (const edge of [...model.edges].sort((a, b) => `${a.from}\u0000${a.to}`.localeCompare(`${b.from}\u0000${b.to}`))) {
    lines.push(`  [${ids.get(edge.from)}] uses --> [${ids.get(edge.to)}]`);
  }
  lines.push(']');
  if (model.elided.count > 0) {
    lines.push(`// elided ${model.elided.count} component(s) touched by no story and no 1-hop dependency`);
  }
  return `${lines.join('\n')}\n`;
}

function statusCounts(models) {
  const counts = { done: 0, 'in-progress': 0, 'not-started': 0 };
  for (const model of models) for (const c of model.components) counts[c.status] += 1;
  return counts;
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  a { color: #2a5db0; }
  .legend span { display: inline-block; margin-right: 1rem; }
  .sw { display: inline-block; width: .8rem; height: .8rem; border: 1px solid #333; vertical-align: middle; margin-right: .3rem; }
  .notstarted { background: ${STATUS_COLORS['not-started']}; }
  .inprogress { background: ${STATUS_COLORS['in-progress']}; }
  .done { background: ${STATUS_COLORS.done}; }
  .diagram { border: 1px solid #ddd; padding: 1rem; margin: .5rem 0 1.5rem; overflow: auto; }
  .diagram g[title] { cursor: pointer; }
  .diagram g[title]:hover { opacity: .82; }
  ul { padding-left: 1.1rem; } ul.components { list-style: none; padding-left: 0; columns: 2; }
  table { border-collapse: collapse; } td, th { text-align: left; padding: .2rem .8rem .2rem 0; }
  .note { color: #666; }
`;

function legendHtml() {
  return `<p class="legend"><span><span class="sw notstarted"></span>${PNG['not-started']}</span>`
    + `<span><span class="sw inprogress"></span>${PNG['in-progress']}</span>`
    + `<span><span class="sw done"></span>${PNG.done}</span></p>`;
}

/** The root page: one link per package, with a status rollup. */
export function renderIndexHtml(packages, { warning = null } = {}) {
  const rows = packages.map((p) => {
    const c = p.counts;
    return `<tr><td><a href="${escapeHtml(safeName(p.id))}/index.html">${escapeHtml(p.name)}</a></td>`
      + `<td>${p.diagrams.length}</td><td class="done">${c.done}</td>`
      + `<td class="inprogress">${c['in-progress']}</td><td class="notstarted">${c['not-started']}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cadet component diagrams</title><style>${STYLE}</style></head>
<body>
<h1>Component diagrams</h1>
${legendHtml()}
${warning ? `<p class="note">⚠️ ${escapeHtml(warning)}</p>` : ''}
${packages.length === 0
    ? '<p class="note">No packages with C# sources were found.</p>'
    : `<table><thead><tr><th>Package</th><th>Diagrams</th><th>done</th><th>in&nbsp;progress</th><th>not&nbsp;started</th></tr></thead><tbody>\n${rows}\n</tbody></table>`}
</body></html>
`;
}

/**
 * Click-to-drill: nomnoml sets each node group's `data-name` to the node's id,
 * so the mapping from id to page is enough to make a box a link. Attached to the
 * inline SVG, so it works from a plain double-click on the file.
 */
const DRILL_SCRIPT = `document.querySelectorAll('.diagram[data-drill]').forEach(function (box) {
  var map = JSON.parse(box.getAttribute('data-drill'));
  box.querySelectorAll('g[data-name]').forEach(function (g) {
    var hit = map[g.getAttribute('data-name')];
    if (!hit) return;
    g.setAttribute('title', 'Open ' + hit.n);
    g.addEventListener('click', function (e) { e.stopPropagation(); location.href = hit.u; });
  });
});`;

function statusName(status) {
  return PNG[status] || status;
}

/** A package page: a component index, then one clickable diagram per epic. */
export function renderPackageHtml({ pkg, components, slugs, componentStatus, entries }) {
  const statusOf = (id) => componentStatus.get(`${pkg.id}::${id}`) || 'not-started';
  const index = [...components]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `<li><span class="sw ${STATUS_CLASS[statusOf(c.id)]}"></span>`
      + `<a href="components/${escapeHtml(slugs.get(c.id))}.html">${escapeHtml(c.namespace || c.name)}</a>`
      + ` <span class="note">${escapeHtml(statusName(statusOf(c.id)))}</span></li>`)
    .join('\n');

  const sections = entries.map(({ epicId, model, svg }) => {
    const counts = statusCounts([model]);
    const ids = nomlIds(model);
    const drill = {};
    for (const c of model.components) {
      drill[ids.get(c.id)] = { u: `components/${slugs.get(c.id)}.html`, n: c.namespace || c.name };
    }
    const elision = model.elided.count > 0
      ? `<p class="note">${model.elided.count} component(s) elided (touched by no story and no 1-hop dependency).</p>`
      : '';
    return `<h2>${escapeHtml(epicId)}</h2>
<p class="note">epic status: ${escapeHtml(model.epic.status)} — ${counts.done} done, ${counts['in-progress']} in progress, ${counts['not-started']} not started. Click a component to open it.</p>
<div class="diagram" data-drill="${escapeHtml(JSON.stringify(drill))}">${svg}</div>
${elision}`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)} — component diagrams</title><style>${STYLE}</style></head>
<body>
<p><a href="../index.html">&larr; all packages</a></p>
<h1>${escapeHtml(pkg.name)}</h1>
${legendHtml()}
<h2>Components</h2>
<ul class="components">
${index}
</ul>
${sections}
${entries.length ? `<script>${DRILL_SCRIPT}</script>` : ''}
</body></html>
`;
}

/** The drill-down target: what a component is, contains, depends on, and comes from. */
export function renderComponentHtml({ pkg, component, status, slugs, components, edges, work, files, types, rootRel }) {
  const name = component.namespace || component.name;
  const byId = new Map(components.map((c) => [c.id, c]));
  const link = (c) => `<a href="${escapeHtml(slugs.get(c.id))}.html">${escapeHtml(c.namespace || c.name)}</a>`;

  const dependsOn = edges.filter((e) => e.from === component.id).map((e) => byId.get(e.to)).filter(Boolean);
  const usedBy = edges.filter((e) => e.to === component.id).map((e) => byId.get(e.from)).filter(Boolean);
  const toHref = (file) => (rootRel && rootRel !== '.' ? `${rootRel}/${file}` : file);

  const list = (items, empty) => (items.length
    ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
    : `<p class="note">${empty}</p>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(name)} — component</title><style>${STYLE}</style></head>
<body>
<p><a href="../index.html">&larr; ${escapeHtml(pkg.name)}</a> · <a href="../../index.html">all packages</a></p>
<h1>${escapeHtml(name)}</h1>
<p><span class="sw ${STATUS_CLASS[status]}"></span> ${escapeHtml(statusName(status))} · package ${escapeHtml(pkg.name)}</p>

<h2>Files (${files.length})</h2>
${list(files.map((f) => `<a href="${escapeHtml(toHref(f))}">${escapeHtml(f)}</a>`), 'No files.')}

<h2>Types (${types.length})</h2>
${list(types.map((t) => `${escapeHtml(t.kind)} <strong>${escapeHtml(t.name)}</strong> <span class="note">${escapeHtml(t.file)}</span>`), 'No type declarations were found.')}

<h2>Depends on (${dependsOn.length})</h2>
${list(dependsOn.map(link), 'Nothing else in this package.')}

<h2>Used by (${usedBy.length})</h2>
${list(usedBy.map(link), 'Nothing else in this package.')}

<h2>Work (${work.length})</h2>
${list(work.map((w) => `${escapeHtml(w.epicId)} / ${escapeHtml(w.storyId)} — ${escapeHtml(statusName(w.status))}`), 'No story has touched this component yet.')}
</body></html>
`;
}

/** Write generated files atomically, creating directories as needed. */
export function writeDiagramFiles(files) {
  for (const file of files) writeFileAtomic(file.path, file.content);
}

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

/** Remove empty directories under `dir`, deepest first. `dir` itself is kept. */
function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    pruneEmptyDirs(full);
    try {
      if (readdirSync(full).length === 0) rmdirSync(full);
    } catch {
      // Left in place if it is not empty or cannot be removed.
    }
  }
}

/**
 * Write the tree, and remove what a PREVIOUS run wrote and this one did not.
 *
 * Without this a re-run leaves stale artifacts: running once with test
 * assemblies and then again without left every test-assembly directory in place,
 * so the tree claimed 30 packages when the model had 6. A manifest of the files
 * this command wrote is the only safe way to prune — it deletes its own output
 * and nothing else, even when `--out` points into a shared directory.
 */
export function syncDiagramTree(outDir, files) {
  const manifestPath = join(outDir, DIAGRAM_MANIFEST);
  let previous = [];
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (Array.isArray(parsed?.files)) previous = parsed.files;
  } catch {
    // No manifest, or an unreadable one: nothing can be proven ours to delete.
  }

  const next = files.map((file) => toPosix(relative(outDir, file.path)));
  const keep = new Set(next);

  let removed = 0;
  for (const rel of previous) {
    if (keep.has(rel)) continue;
    try {
      unlinkSync(join(outDir, rel));
      removed += 1;
    } catch {
      // Already gone; the count is of files actually removed.
    }
  }
  if (removed > 0) pruneEmptyDirs(outDir);

  writeDiagramFiles(files);
  writeFileAtomic(manifestPath, `${JSON.stringify({ generatedBy: 'cadet-agent harness diagram', files: [...next].sort() }, null, 2)}\n`);
  return { written: files.length, removed };
}

/**
 * Build the whole diagram tree without touching disk.
 *
 * Returns `{ files, summary, warning }`; the caller writes `files` and reports
 * `summary`. `warning` is non-null when the run could not see any work, so the
 * output says why everything is red instead of implying nothing was built.
 */
export function generateDiagrams({ rootDir, outDir, csRoot = rootDir, state = null, packageFilter = null, includeTests = false }) {
  const packages = scanPackages(csRoot)
    // Test assemblies are excluded by default: they are numerous, each holds a
    // single namespace, and their one-component diagrams crowd the index. The
    // selection is by the assembly's TestRunner/nunit references, not its name.
    .filter((p) => includeTests || !p.isTest)
    .filter((p) => !packageFilter || p.id === packageFilter);
  const { byFile, componentsByPkg, edgesByPkg } = indexComponents(csRoot, packages);
  const workItemFiles = collectWorkItemFiles(rootDir, state);
  const componentWork = componentWorkMap({ state, byFile, workItemFiles });
  const componentStatus = statusesFromWork(componentWork);
  const epicIds = state?.epics && typeof state.epics === 'object' ? Object.keys(state.epics).sort() : [];

  const files = [];
  const summaryPackages = [];
  let warning = null;

  for (const pkg of packages) {
    const components = componentsByPkg.get(pkg.id) || [];
    const edges = edgesByPkg.get(pkg.id) || [];
    if (components.length === 0) continue;

    const entries = [];
    if (epicIds.length === 0) {
      const model = buildStructureModel({ pkg, components, edges, allPackages: packages });
      entries.push({ epicId: 'structure', model });
      warning = warning || 'no work record found (.cadet/state.json has no epics): rendering structure only — every component reads "not started".';
    } else {
      for (const epicId of epicIds) {
        const model = buildDiagramModel({ pkg, epicId, state, components, edges, byFile, workItemFiles, allPackages: packages, componentStatus });
        if (model.components.length > 0) entries.push({ epicId, model });
      }
    }

    const rendered = entries.map(({ epicId, model }) => {
      const noml = renderNoml(model);
      return { epicId, model, noml, svg: renderSvg(noml) };
    });

    const pkgDir = join(outDir, safeName(pkg.id));
    for (const { epicId, svg, noml } of rendered) {
      files.push({ path: join(pkgDir, `${safeName(epicId)}.noml`), content: noml });
      files.push({ path: join(pkgDir, `${safeName(epicId)}.svg`), content: svg });
    }

    // A page per component, for every component in the package: the package index
    // links them all, so no component page is unreachable, and a diagram node can
    // point at one without the link ever dangling.
    const slugs = componentSlugs(components);
    const componentDir = join(pkgDir, 'components');
    const rootRel = toPosix(relative(componentDir, rootDir)) || '.';
    for (const component of components) {
      const key = `${pkg.id}::${component.id}`;
      files.push({
        path: join(componentDir, `${slugs.get(component.id)}.html`),
        content: renderComponentHtml({
          pkg,
          component,
          status: componentStatus.get(key) || 'not-started',
          slugs,
          components,
          edges,
          work: [...(componentWork.get(key)?.values() || [])]
            .sort((a, b) => `${a.epicId}/${a.storyId}`.localeCompare(`${b.epicId}/${b.storyId}`)),
          files: component.files.map((f) => rel(rootDir, f)),
          types: parseTypes(component.files).map((t) => ({ ...t, file: rel(rootDir, t.file) })),
          rootRel,
        }),
      });
    }

    files.push({
      path: join(pkgDir, 'index.html'),
      content: renderPackageHtml({ pkg, components, slugs, componentStatus, entries: rendered }),
    });

    summaryPackages.push({
      id: pkg.id,
      name: pkg.name,
      components: components.length,
      diagrams: rendered.map((r) => ({
        epic: r.epicId,
        components: r.model.components.length,
        elided: r.model.elided.count,
        counts: statusCounts([r.model]),
      })),
      counts: statusCounts(rendered.map((r) => r.model)),
    });
  }

  files.push({ path: join(outDir, 'index.html'), content: renderIndexHtml(summaryPackages, { warning }) });

  const summary = {
    outDir,
    packages: summaryPackages,
    diagrams: summaryPackages.reduce((n, p) => n + p.diagrams.length, 0),
    files: files.length,
    warning,
  };
  return { files, summary };
}
