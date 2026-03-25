import * as path from 'path';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { serializeFrontmatter } from '../utils/frontmatter.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit a Cursor skill/rule from SkillIR.
 */
export function emitCursorSkill(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];
  const files: { path: string; content: string }[] = [];

  // Determine if this should be a skill or a rule
  const isSkill = !!(ir.scripts?.length || ir.references?.length || ir.sourceFormat === 'claude');
  const isAlwaysRule = ir.activation.mode === 'always' && !isSkill;

  // Core fields — always native
  warnings.push({ field: 'name, description, body', level: 'native', message: 'Core fields preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Markdown body preserved' });

  let body = ir.body;

  // Handle allowed-tools — shimmed as instruction
  if (ir.allowedTools?.length) {
    body = `<!-- SKILLPORT: Tool restrictions from source. Only use: ${ir.allowedTools.join(', ')} -->\n\n**Tool restrictions:** This skill should only use: ${ir.allowedTools.join(', ')}\n\n${body}`;
    warnings.push({ field: 'allowed-tools', level: 'shimmed', message: `allowed-tools [${ir.allowedTools.join(', ')}] is now an instruction, not enforced. The agent may ignore it. In Claude Code this was a hard constraint.` });
    features.push({ feature: 'Tool restrictions', status: 'shimmed', percent: 80, notes: 'Instruction text, not enforced' });
  }

  // Handle hooks
  if (ir.hooks?.length) {
    const cursorHookMap: Record<string, string> = {
      'PreToolUse': 'beforeShellExecution',
      'PostToolUse': 'afterFileEdit',
    };

    const nativeHooks = ir.hooks.filter((h) => h.event in cursorHookMap && h.handler.type === 'command');
    const nonNativeHooks = ir.hooks.filter((h) => !(h.event in cursorHookMap) || h.handler.type !== 'command');

    if (nativeHooks.length) {
      // Cursor supports some hooks natively — but they go in settings, not in skill
      // Add annotation about where to configure them
      body += `\n\n<!-- SKILLPORT: The following hooks should be configured in Cursor settings:\n${nativeHooks.map((h) => `  ${cursorHookMap[h.event]}: ${h.handler.value}`).join('\n')}\n-->`;
      warnings.push({ field: 'hooks (native)', level: 'shimmed', message: `${nativeHooks.length} hooks mapped to Cursor events (${nativeHooks.map((h) => cursorHookMap[h.event]).join(', ')}). Must be configured in Cursor settings, not in skill file.` });
      features.push({ feature: 'Hooks (shell)', status: 'shimmed', percent: 60, notes: `${nativeHooks.length} mapped to Cursor events` });
    }

    if (nonNativeHooks.length) {
      body += `\n\n<!-- SKILLPORT: The following hooks have no Cursor equivalent:\n${nonNativeHooks.map((h) => `  ${h.event}(${h.matcher || '*'}): ${h.handler.type} → ${h.handler.value}`).join('\n')}\n-->`;
      warnings.push({ field: 'hooks (non-native)', level: 'dropped', message: `${nonNativeHooks.length} hooks (${nonNativeHooks.map((h) => `${h.event}/${h.handler.type}`).join(', ')}) have no Cursor equivalent. Annotated as comments.` });
      features.push({ feature: 'Hooks (prompt/agent)', status: 'dropped', percent: 0, notes: 'No Cursor equivalent' });
    }
  }

  // Handle subagent
  if (ir.subagent?.enabled) {
    // Cursor 2.0+ supports subagents
    body += `\n\n<!-- SKILLPORT: This skill uses subagent isolation (context: ${ir.subagent.isolation}). Cursor supports subagents natively via its subagent system. -->`;
    warnings.push({ field: 'subagent', level: 'shimmed', message: `Subagent config (${ir.subagent.isolation}, type: ${ir.subagent.agentType || 'default'}) noted. Cursor has native subagents but configuration differs.` });
    features.push({ feature: 'Subagent isolation', status: 'shimmed', percent: 70, notes: 'Cursor subagents available, config differs' });
  }

  // Handle dynamic context
  if (ir.dynamicContext?.length) {
    // Generate a preprocessor script
    const renderScript = generateRenderScript(ir.dynamicContext);
    files.push({ path: path.join(outputDir, '.cursor', 'skills', ir.name, 'scripts', 'render-context.sh'), content: renderScript });
    body = `**Note:** Run \`scripts/render-context.sh\` before first use to inject dynamic context.\n\n${body}`;
    warnings.push({ field: 'dynamic-context', level: 'shimmed', message: `${ir.dynamicContext.length} dynamic context commands converted to render-context.sh script. Must be run manually - Cursor has no preprocessing.` });
    features.push({ feature: 'Dynamic context', status: 'shimmed', percent: 30, notes: 'Wrapper script, manual run' });
  }

  // Handle model/effort — no Cursor equivalent
  if (ir.model) {
    warnings.push({ field: 'model', level: 'dropped', message: `Model override "${ir.model}" has no Cursor skill equivalent — dropped` });
    features.push({ feature: 'Model override', status: 'dropped', percent: 0, notes: 'No Cursor equivalent' });
  }
  if (ir.effort) {
    warnings.push({ field: 'effort', level: 'dropped', message: `Effort level "${ir.effort}" has no Cursor equivalent — dropped` });
  }

  // Activation
  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: `description-based discovery` });

  if (isSkill) {
    // Emit as .cursor/skills/<name>/SKILL.md
    const fm: Record<string, unknown> = {
      name: ir.name,
      description: ir.description,
    };
    if (ir.version) fm['version'] = ir.version;

    const skillMd = serializeFrontmatter(fm, body);
    const skillDir = path.join(outputDir, '.cursor', 'skills', ir.name);
    files.push({ path: path.join(skillDir, 'SKILL.md'), content: skillMd });

    // Copy scripts
    if (ir.scripts?.length) {
      for (const script of ir.scripts) {
        files.push({ path: path.join(skillDir, 'scripts', script.path), content: script.content });
      }
    }
    if (ir.references?.length) {
      for (const ref of ir.references) {
        files.push({ path: path.join(skillDir, 'references', ref.path), content: ref.content });
      }
    }
  } else {
    // Emit as .cursor/rules/<name>.mdc
    const fm: Record<string, unknown> = {};
    if (ir.description) fm['description'] = ir.description;
    if (ir.activation.mode === 'always') fm['alwaysApply'] = true;
    if (ir.activation.globs?.length) fm['globs'] = ir.activation.globs;

    const ruleMdc = serializeFrontmatter(fm, body, { mdcMode: true });
    files.push({ path: path.join(outputDir, '.cursor', 'rules', `${ir.name}.mdc`), content: ruleMdc });
  }

  return { files, warnings, parity: buildParity(features, ir) };
}

function generateRenderScript(contexts: { placeholder: string; command: string }[]): string {
  const lines = [
    '#!/bin/bash',
    '# Generated by skillport — renders dynamic context placeholders',
    '# Run this before first use to inject live data into the skill',
    '',
    'SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    'SKILL_FILE="$SKILL_DIR/SKILL.md"',
    '',
  ];

  for (const ctx of contexts) {
    const escaped = ctx.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    lines.push(`# Evaluate: ${ctx.placeholder}`);
    lines.push(`RESULT=$(${ctx.command} 2>/dev/null || echo "[command failed]")`);
    lines.push(`sed -i '' "s|${escaped}|$RESULT|g" "$SKILL_FILE"`);
    lines.push('');
  }

  lines.push('echo "Dynamic context rendered successfully"');
  return lines.join('\n');
}
