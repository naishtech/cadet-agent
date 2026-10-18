/**
 * nomnoml renderer wrapper — the only place the framework's UML dependency is
 * touched.
 *
 * nomnoml is CommonJS; this package is ESM. `createRequire` is the interop that
 * works regardless of how Node's named-export detection reads the bundle, and it
 * keeps the load lazy so a run that never renders a diagram never pays for it.
 *
 * The dependency is deliberate and is recorded in the plan and the architecture
 * decision: it breaks the framework's long-standing "dependency-free" property in
 * exchange for a real UML renderer instead of a hand-drawn one.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cached = null;

function loadRenderer() {
  if (cached) return cached;
  try {
    cached = require('nomnoml');
  } catch (err) {
    throw new Error(
      `the UML renderer "nomnoml" is not installed (${err.message}). Run "npm install" in the cadet-agent package.`,
    );
  }
  return cached;
}

/** Render nomnoml source to an SVG string. */
export function renderSvg(source) {
  const nomnoml = loadRenderer();
  if (typeof nomnoml.renderSvg !== 'function') {
    throw new Error('nomnoml did not expose renderSvg; the installed version is not the expected one.');
  }
  return nomnoml.renderSvg(String(source));
}

/** The installed nomnoml version, or null when it cannot be read. */
export function nomnomlVersion() {
  try {
    return loadRenderer().version || null;
  } catch {
    return null;
  }
}
