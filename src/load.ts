import type { CheckCommand } from './hook.ts';

export type ModuleImporter = () => Promise<unknown>;

/** Imports cc-safety-net via its official `./api` export. */
export const importCcSafetyNet: ModuleImporter = () => import('cc-safety-net/api');

/**
 * Load cc-safety-net's `checkCommand`. Uses a dynamic import (rather than a
 * static one) so a missing or broken install can be caught and turned into a
 * fail-closed deny with an explanation, instead of crashing the hook.
 * Rejects if the module can't be imported or has no `checkCommand` export.
 */
export async function loadCheckCommand(importer: ModuleImporter = importCcSafetyNet): Promise<CheckCommand> {
  const mod = await importer();
  const checkCommand =
    typeof mod === 'object' && mod !== null ? (mod as { checkCommand?: unknown }).checkCommand : undefined;
  if (typeof checkCommand !== 'function') {
    throw new Error('checkCommand export not found in cc-safety-net/api');
  }
  return checkCommand as CheckCommand;
}
