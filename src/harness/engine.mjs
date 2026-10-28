/**
 * The engine seam — what engine this project runs, and where its commands live.
 *
 * Two files carry the engine choice: `.cadet/engine.json`, written by the
 * installer, and `.cadet/agent/core/engines/<engine>/`, the pack. A phase skill
 * asks this module which engine it has; the skill names the capability, the pack
 * names the command. Core composes no command at all, and that is the point: a
 * guessed `dotnet build` in a project that builds with Unreal's Build.bat is
 * worse than a question. `commandFor` therefore answers with the stop sentence
 * or with the pack that owns the command, and never with a string to run.
 *
 * READ-ONLY except `writeEngine`, which the installer calls.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ENGINE_FILE_REL = '.cadet/engine.json';
export const ENGINES_DIR_REL = '.cadet/agent/core/engines';

/** The engines a pack can exist for. Order is the primary engine's order. */
export const ENGINE_NAMES = Object.freeze(['unity', 'unreal']);

/**
 * What every pack must answer for, in the words a phase skill uses. A skill
 * names one of these; the pack maps it to its own command.
 */
export const CAPABILITIES = Object.freeze(['build', 'test', 'verify', 'run']);

/** The command that writes a missing engine configuration. */
export const INIT_COMMAND = 'npx cadet-agent@latest init';

/**
 * Where each engine's tooling installs in a consumer project. Decision D6 fixes
 * both paths; a pack may not move them.
 */
export const DEFAULT_PLUGIN_ROOTS = Object.freeze({
  unity: 'Assets/Covyne/Cadet',
  unreal: 'Plugins/CadetBuild',
});

export function engineFilePath(targetDir) {
  return join(targetDir, ENGINE_FILE_REL);
}

/** The pack's entry point, relative to the consumer root. */
export function enginePackRel(engine) {
  return `${ENGINES_DIR_REL}/${engine}/README.md`;
}

/**
 * Pick the engines to record, highest precedence first: what the user answered,
 * what the installer detected, then what the components themselves prove.
 *
 * The answer outranks detection because a project can hold both marker sets and
 * the user still named one primary. The component list is the last resort, and it
 * is the only source for `--components`, which answers no question and skips
 * detection on purpose.
 */
export function resolveEngines({ answered = [], detected = [], components = [] } = {}) {
  const known = (list) => (Array.isArray(list) ? list : []).filter((e) => ENGINE_NAMES.includes(e));
  const fromAnswer = known(answered);
  if (fromAnswer.length) return fromAnswer;
  const fromDetection = known(detected);
  if (fromDetection.length) return fromDetection;
  return ENGINE_NAMES.filter((e) => components.includes(`engine.${e}.plugin`));
}

/** The stop sentence for a project that cannot answer "which engine". */
function stopFor(reason, engine) {
  if (reason === 'absent') {
    return `No engine is configured in this project (${ENGINE_FILE_REL} is missing); run ${INIT_COMMAND} to write it.`;
  }
  if (reason === 'unreadable') {
    return `${ENGINE_FILE_REL} could not be read as JSON; fix the file, or run ${INIT_COMMAND} to rewrite it.`;
  }
  if (reason === 'inconsistent') {
    return `${ENGINE_FILE_REL} names engine "${engine}" but holds no settings for it; run ${INIT_COMMAND} to rewrite the file.`;
  }
  if (reason === 'pack-missing') {
    return `Engine "${engine}" is configured, but its pack is missing (${enginePackRel(engine)}); run ${INIT_COMMAND} to install it.`;
  }
  return null;
}

/**
 * Read the engine configuration.
 *
 * Returns one object for every case, so a caller has one shape to branch on:
 *
 *   missing   — true when no usable engine.json exists (absent, unreadable, or
 *               naming an engine it does not configure)
 *   reason    — null, or 'absent' | 'unreadable' | 'inconsistent' | 'pack-missing'
 *   engine    — the primary engine, or null
 *   engines   — every configured engine, primary first
 *   pack      — the primary engine's pack path, relative to the consumer root
 *   packs     — { engine, path, installed } per configured engine
 *   stop      — the one sentence a skill states instead of running a command,
 *               or null when the seam is whole
 */
export function readEngine(targetDir) {
  const raw = (() => {
    try {
      return readFileSync(engineFilePath(targetDir), 'utf-8');
    } catch {
      return null;
    }
  })();

  const empty = (reason, engine = null) => ({
    configured: false,
    missing: true,
    reason,
    engine,
    engines: [],
    pack: null,
    packs: [],
    stop: stopFor(reason, engine),
  });

  if (raw === null) return empty('absent');

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return empty('unreadable');
  }

  const configured = ENGINE_NAMES.filter((e) => config?.[e] && typeof config[e] === 'object');
  const primary = config?.engine;

  if (!configured.length || !ENGINE_NAMES.includes(primary)) return empty('unreadable');
  if (!configured.includes(primary)) return empty('inconsistent', primary);

  const packs = configured.map((engine) => ({
    engine,
    path: enginePackRel(engine),
    installed: existsSync(join(targetDir, enginePackRel(engine))),
  }));
  const primaryPack = packs.find((p) => p.engine === primary);
  const reason = primaryPack.installed ? null : 'pack-missing';

  return {
    configured: true,
    missing: false,
    reason,
    engine: primary,
    engines: configured,
    pack: primaryPack.path,
    packs,
    stop: reason ? stopFor(reason, primary) : null,
  };
}

/**
 * May core run this capability's command?
 *
 * No, and the answer says where the command lives instead. The two stop cases
 * come first, because a skill must state them before it looks for anything to
 * run. This function exists so a caller has to ask: a helper that quietly
 * composed a command would undo the seam it exists to hold.
 */
export function commandFor(targetDir, capability) {
  if (!CAPABILITIES.includes(capability)) {
    throw new TypeError(`unknown engine capability "${capability}" (expected: ${CAPABILITIES.join('|')})`);
  }

  const status = readEngine(targetDir);
  if (status.stop) {
    return { capability, command: null, blocked: status.reason, message: status.stop, pack: status.pack };
  }
  return {
    capability,
    command: null,
    blocked: 'pack',
    message: `The ${capability} command is defined by the ${status.engine} pack: ${status.pack}`,
    pack: status.pack,
  };
}

/**
 * The project's editor version, read from the project rather than guessed.
 * Null when the project does not say.
 */
function readEditorVersion(targetDir, engine) {
  if (engine === 'unity') {
    try {
      const text = readFileSync(join(targetDir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf-8');
      const match = text.match(/m_EditorVersion:\s*(\S+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
  if (engine === 'unreal') {
    try {
      const descriptor = readdirSync(targetDir).find((name) => name.toLowerCase().endsWith('.uproject'));
      if (!descriptor) return null;
      const text = readFileSync(join(targetDir, descriptor), 'utf-8');
      return JSON.parse(text).EngineAssociation || null;
    } catch {
      return null;
    }
  }
  return null;
}

function engineBlock(targetDir, engine) {
  const pluginRoot = DEFAULT_PLUGIN_ROOTS[engine];
  return {
    pluginRoot,
    cliRoot: `${pluginRoot}/CLI`,
    editorVersion: readEditorVersion(targetDir, engine),
  };
}

/**
 * Write `.cadet/engine.json` from the engines this install covers.
 *
 * The installer owns this file; a hand edit survives until the next install or
 * sync, and readEngine reports what it finds rather than repairing it. No engine
 * means no file: a Node repository, such as this one, is not a game project and
 * must not be told it is one.
 */
export function writeEngine(targetDir, { engines = [], components = [] } = {}) {
  const names = resolveEngines({ answered: engines, components });
  if (!names.length) {
    return { written: false, reason: 'no engine was chosen or detected', path: null, config: null };
  }

  const config = { schemaVersion: 1, engine: names[0] };
  for (const engine of ENGINE_NAMES) {
    config[engine] = names.includes(engine) ? engineBlock(targetDir, engine) : null;
  }

  const path = engineFilePath(targetDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return { written: true, reason: null, path, config };
}
