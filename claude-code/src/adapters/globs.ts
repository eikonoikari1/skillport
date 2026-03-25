import type { HarnessType } from '../ir.js';

/**
 * Glob activation support per harness.
 */
export const GLOB_SUPPORT: Record<HarnessType, {
  native: boolean;
  fieldName: string | null;
  notes: string;
}> = {
  claude:   { native: true,  fieldName: 'paths',    notes: 'Supported in .claude/rules/ files' },
  cursor:   { native: true,  fieldName: 'globs',    notes: 'Native in .mdc frontmatter' },
  codex:    { native: false, fieldName: null,        notes: 'No glob activation. AGENTS.md loaded by directory path.' },
  openclaw: { native: false, fieldName: null,        notes: 'No glob support. Skills are all-or-nothing.' },
  copilot:  { native: true,  fieldName: 'applyTo',  notes: 'Supported in .instructions.md frontmatter' },
  windsurf: { native: false, fieldName: null,        notes: 'No glob support.' },
};

/**
 * Convert glob patterns between harness-specific formats.
 * Most use standard minimatch/glob patterns, but field names differ.
 */
export function convertGlobs(globs: string[], _from: HarnessType, _to: HarnessType): string[] {
  // Glob patterns are largely interchangeable between harnesses.
  // The main difference is the field name (globs vs paths vs applyTo).
  return globs;
}
