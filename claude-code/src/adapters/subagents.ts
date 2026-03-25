import type { SkillIR, HarnessType } from '../ir.js';

/**
 * Subagent support level per harness.
 */
export const SUBAGENT_SUPPORT: Record<HarnessType, {
  native: boolean;
  mechanism: string;
  notes: string;
}> = {
  claude:   { native: true,  mechanism: 'context: fork',         notes: 'Full subagent with isolated context, parallel/background modes' },
  cursor:   { native: true,  mechanism: 'Cursor subagents',      notes: 'Native subagents with is_background, git worktree isolation (v2.0+)' },
  codex:    { native: true,  mechanism: 'fork command',           notes: 'Explicit fork spawning, inherits sandbox rules' },
  openclaw: { native: false, mechanism: 'multi-agent config',     notes: 'No native subagent primitive. Use community skills or multi-agent setup' },
  copilot:  { native: false, mechanism: 'none',                   notes: 'No subagent support' },
  windsurf: { native: false, mechanism: 'none',                   notes: 'No subagent support' },
};

/**
 * Generate an instruction annotation for subagent emulation.
 */
export function subagentInstruction(ir: SkillIR, target: HarnessType): string | null {
  if (!ir.subagent?.enabled) return null;

  const support = SUBAGENT_SUPPORT[target];
  if (support.native) return null; // handled natively by emitter

  return `<!-- SKILLPORT: This skill uses subagent isolation (${ir.subagent.isolation}, agent: ${ir.subagent.agentType || 'default'}). ${support.notes}. Consider breaking the skill into sequential steps instead. -->`;
}
