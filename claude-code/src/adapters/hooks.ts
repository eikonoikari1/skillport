import type { HookIR, HarnessType } from '../ir.js';

/**
 * Hook event mapping across harnesses.
 * Maps Claude Code hook events to their closest equivalents.
 */
export const HOOK_MAP: Record<string, Partial<Record<HarnessType, string | null>>> = {
  'PreToolUse':       { claude: 'PreToolUse',       cursor: 'beforeShellExecution', codex: null, openclaw: 'command:new', copilot: null, windsurf: null },
  'PostToolUse':      { claude: 'PostToolUse',      cursor: 'afterFileEdit',        codex: null, openclaw: null,          copilot: null, windsurf: null },
  'PreToolUse(mcp)':  { claude: 'PreToolUse',       cursor: 'beforeMCPExecution',   codex: null, openclaw: null,          copilot: null, windsurf: null },
  'Stop':             { claude: 'Stop',             cursor: 'stop',                 codex: null, openclaw: '/stop',       copilot: null, windsurf: null },
  'SessionStart':     { claude: 'SessionStart',     cursor: null,                   codex: null, openclaw: null,          copilot: null, windsurf: null },
  'SessionEnd':       { claude: 'SessionEnd',       cursor: null,                   codex: null, openclaw: null,          copilot: null, windsurf: null },
};

/**
 * Handler type support per harness.
 */
export const HANDLER_SUPPORT: Record<HarnessType, Set<HookIR['handler']['type']>> = {
  claude:   new Set(['command', 'prompt', 'agent', 'http']),
  cursor:   new Set(['command']),
  codex:    new Set([]),
  openclaw: new Set(['command']),
  copilot:  new Set([]),
  windsurf: new Set([]),
};

/**
 * Check if a hook can be natively mapped to the target harness.
 */
export function canMapHook(hook: HookIR, target: HarnessType): 'native' | 'partial' | 'none' {
  const eventKey = hook.matcher?.startsWith('mcp__') ? 'PreToolUse(mcp)' : hook.event;
  const targetEvent = HOOK_MAP[eventKey]?.[target];

  if (!targetEvent) return 'none';
  if (!HANDLER_SUPPORT[target].has(hook.handler.type)) return 'partial';
  return 'native';
}

/**
 * Get the target event name for a hook in the target harness.
 */
export function getTargetEvent(hook: HookIR, target: HarnessType): string | null {
  const eventKey = hook.matcher?.startsWith('mcp__') ? 'PreToolUse(mcp)' : hook.event;
  return HOOK_MAP[eventKey]?.[target] ?? null;
}
