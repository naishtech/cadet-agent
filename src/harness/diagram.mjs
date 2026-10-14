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

import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { scanPackages, scanComponents, componentEdges, toPosix } from './csharp.mjs';
import { renderSvg } from './noml.mjs';

/** Where the generated tree lands, relative to the target repository. */
export const DIAGRAM_OUT_DIR = '.cadet/diagrams';

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

function statusOf(storyStatuses) {
  if (!storyStatuses || storyStatuses.size === 0) return 'not-started';
  return [...storyStatuses.values()].every((s) => s === 'done') ? 'done' : 'in-progress';
}

/**
 * Every component's status, from every story in every epic that touched it.
 *
 * Cumulative on purpose: a component that is finished is green. Deriving the
 * status from only the current epic made a built component read red in a later
 * epic's diagram — measured on a real project, where one component was green in
 * one epic and red in the next. The epic still decides what a diagram SHOWS; it
 * no longer decides the colour.
 */
export function componentStatusMap({ state, byFile, workItemFiles }) {
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
        byComponent.get(key).set(`${epicId}::${storyFile}`, status);
      }
    }
  }
  const statuses = new Map();
  for (const [key, stories] of byComponent) statuses.set(key, statusOf(stories));
  return statuses;
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
  const nameOf = new Map(model.components.map((c) => [c.id, nomlName(c.namespace || c.name)]));
  const lines = [
    '#direction: right',
    `#.${STATUS_CLASS['not-started']}: fill=${STATUS_COLORS['not-started']}`,
    `#.${STATUS_CLASS['in-progress']}: fill=${STATUS_COLORS['in-progress']}`,
    `#.${STATUS_CLASS.done}: fill=${STATUS_COLORS.done}`,
    `[<frame>${nomlName(model.package.name)}|`,
  ];
  for (const component of [...model.components].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  [<${STATUS_CLASS[component.status]}> ${nomlName(component.namespace || component.name)}]`);
  }
  for (const edge of [...model.edges].sort((a, b) => `${a.from}\u0000${a.to}`.localeCompare(`${b.from}\u0000${b.to}`))) {
    lines.push(`  [${nameOf.get(edge.from)}] uses --> [${nameOf.get(edge.to)}]`);
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

/** A package page: one embedded diagram per epic. */
export function renderPackageHtml(pkg, entries) {
  const sections = entries.map(({ epicId, model, svg }) => {
    const counts = statusCounts([model]);
    const elision = model.elided.count > 0
      ? `<p class="note">${model.elided.count} component(s) elided (touched by no story and no 1-hop dependency).</p>`
      : '';
    return `<h2>${escapeHtml(epicId)}</h2>
<p class="note">epic status: ${escapeHtml(model.epic.status)} — ${counts.done} done, ${counts['in-progress']} in progress, ${counts['not-started']} not started</p>
<div class="diagram">${svg}</div>
${elision}`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)} — component diagrams</title><style>${STYLE}</style></head>
<body>
<p><a href="../index.html">&larr; all packages</a></p>
<h1>${escapeHtml(pkg.name)}</h1>
${legendHtml()}
${sections}
</body></html>
`;
}

/** Write generated files atomically, creating directories as needed. */
export function writeDiagramFiles(files) {
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    const tmp = `${file.path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(tmp, file.content, 'utf-8');
    renameSync(tmp, file.path);
  }
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
  const componentStatus = componentStatusMap({ state, byFile, workItemFiles });
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
    if (entries.length === 0) continue;

    const rendered = entries.map(({ epicId, model }) => {
      const noml = renderNoml(model);
      return { epicId, model, noml, svg: renderSvg(noml) };
    });

    const pkgDir = join(outDir, safeName(pkg.id));
    for (const { epicId, svg, noml } of rendered) {
      files.push({ path: join(pkgDir, `${safeName(epicId)}.noml`), content: noml });
      files.push({ path: join(pkgDir, `${safeName(epicId)}.svg`), content: svg });
    }
    files.push({ path: join(pkgDir, 'index.html'), content: renderPackageHtml(pkg, rendered) });

    summaryPackages.push({
      id: pkg.id,
      name: pkg.name,
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
