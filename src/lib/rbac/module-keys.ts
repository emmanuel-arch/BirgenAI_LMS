// ─────────────────────────────────────────────────────────────────────────────
// THE TWO FUNCTIONS EVERY NAV TREE NEEDS, AND NOTHING ELSE.
//
// They lived in ./modules beside ACCESS_CATALOG, which is where they belong
// conceptually and is exactly what made them unreachable. The catalogue is built
// eagerly from every system's nav tree — including the console's NAV_REGISTRY —
// and the console's registry in turn calls isDenied() to filter its own modules.
// A cycle: whichever of the two a process imported first, `toModules(NAV_REGISTRY)`
// ran against a registry that had not finished initialising, and the module threw
// "Cannot access 'NAV_REGISTRY' before initialization" at import time. That is
// what had `npm run test:map` dead on arrival.
//
// So the shared half moves HERE, into a file that imports nothing. ./modules
// re-exports both names, so every existing caller is untouched.
// ─────────────────────────────────────────────────────────────────────────────

/** The composite an access editor ticks: "callcenter:promises". */
export const moduleKey = (systemId: string, module: string) => `${systemId}:${module}`;

/**
 * Is this system, or this module inside it, hidden from the caller?
 *
 * Denying a SYSTEM implies denying everything in it, so a caller asking about a
 * module does not have to ask about its system first and cannot forget to.
 */
export function isDenied(denied: ReadonlySet<string>, systemId: string, module?: string): boolean {
  if (denied.has(systemId)) return true;
  return module != null && denied.has(moduleKey(systemId, module));
}
