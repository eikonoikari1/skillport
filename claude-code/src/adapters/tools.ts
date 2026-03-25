import type { HarnessType } from '../ir.js';

/**
 * Tool restriction support per harness.
 */
export const TOOL_RESTRICTION_SUPPORT: Record<HarnessType, {
  level: 'skill' | 'agent' | 'global' | 'none';
  mechanism: string;
  enforced: boolean;
}> = {
  claude:   { level: 'skill',  mechanism: 'allowed-tools in SKILL.md frontmatter', enforced: true },
  cursor:   { level: 'global', mechanism: 'command_allowlist/denylist in yolo mode', enforced: true },
  codex:    { level: 'none',   mechanism: 'OS sandbox only', enforced: false },
  openclaw: { level: 'agent',  mechanism: 'Profile → Allow/Deny → Sandbox Policy', enforced: true },
  copilot:  { level: 'none',   mechanism: 'No tool restrictions', enforced: false },
  windsurf: { level: 'none',   mechanism: 'No tool restrictions', enforced: false },
};

/**
 * Generate a tool restriction annotation for the skill body.
 */
export function toolRestrictionAnnotation(tools: string[], target: HarnessType): string {
  const support = TOOL_RESTRICTION_SUPPORT[target];
  if (support.level === 'skill') return ''; // Handled natively

  const prefix = support.enforced
    ? `Configure at the ${support.level} level via ${support.mechanism}`
    : `Not enforced. ${support.mechanism}`;

  return `**Tool restrictions:** This skill should only use: ${tools.join(', ')}\n<!-- SKILLPORT: ${prefix} -->`;
}
