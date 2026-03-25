import * as path from 'path';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { serializeFrontmatter } from '../utils/frontmatter.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit a Claude Code skill from SkillIR.
 */
export function emitClaudeSkill(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];
  const files: { path: string; content: string }[] = [];

  const skillDir = path.join(outputDir, '.claude', 'skills', ir.name);

  // Build frontmatter
  const fm: Record<string, unknown> = {
    name: ir.name,
    description: ir.description,
  };

  if (ir.version) fm['version'] = ir.version;

  // Activation
  if (ir.activation.mode === 'explicit' || ir.harnessSpecific?.claude?.disableModelInvocation) {
    fm['disable-model-invocation'] = true;
  }
  if (ir.harnessSpecific?.claude?.userInvocable === false) {
    fm['user-invocable'] = false;
  }

  // Allowed tools — native in CC
  if (ir.allowedTools?.length) {
    fm['allowed-tools'] = ir.allowedTools;
    warnings.push({ field: 'allowed-tools', level: 'native', message: 'Tool restrictions applied natively' });
    features.push({ feature: 'Tool restrictions', status: 'native', percent: 100, notes: 'allowed-tools in frontmatter' });
  }

  // Model/effort — native in CC
  if (ir.model) fm['model'] = ir.model;
  if (ir.effort) fm['effort'] = ir.effort;

  // Subagent — native in CC
  if (ir.subagent?.enabled) {
    fm['context'] = ir.subagent.isolation || 'fork';
    if (ir.subagent.agentType) fm['agent'] = ir.subagent.agentType;
    warnings.push({ field: 'subagent', level: 'native', message: 'Subagent config applied natively' });
    features.push({ feature: 'Subagent isolation', status: 'native', percent: 100, notes: `context: ${ir.subagent.isolation}` });
  }

  // Hooks — native in CC
  if (ir.hooks?.length) {
    const hooksObj: Record<string, unknown[]> = {};
    for (const hook of ir.hooks) {
      if (!hooksObj[hook.event]) hooksObj[hook.event] = [];
      const entry: Record<string, unknown> = {};
      if (hook.matcher) entry['matcher'] = hook.matcher;
      entry['hooks'] = [{
        type: hook.handler.type,
        [hook.handler.type === 'command' ? 'command' : hook.handler.type === 'http' ? 'url' : 'prompt']: hook.handler.value,
        ...(hook.handler.timeout ? { timeout: hook.handler.timeout } : {}),
      }];
      hooksObj[hook.event].push(entry);
    }
    fm['hooks'] = hooksObj;
    warnings.push({ field: 'hooks', level: 'native', message: 'Hooks applied natively in frontmatter' });
    features.push({ feature: 'Hooks', status: 'native', percent: 100, notes: `${ir.hooks.length} hooks preserved` });
  }

  // Dynamic context — native in CC
  if (ir.dynamicContext?.length) {
    warnings.push({ field: 'dynamic-context', level: 'native', message: 'Dynamic context interpolation preserved' });
    features.push({ feature: 'Dynamic context', status: 'native', percent: 100, notes: '!`command` syntax native' });
  }

  // Core fields always native
  warnings.push({ field: 'name, description, body', level: 'native', message: 'Core fields preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Markdown body preserved' });
  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: `mode: ${ir.activation.mode}` });

  // Handle globs → activation note in body if coming from cursor
  let body = ir.body;
  if (ir.activation.globs?.length && ir.sourceFormat !== 'claude') {
    features.push({ feature: 'Glob activation', status: 'native', percent: 100, notes: 'Supported via .claude/rules/ paths' });
  }

  // Handle Codex-specific metadata
  if (ir.harnessSpecific?.codex?.displayName) {
    warnings.push({ field: 'codex.displayName', level: 'dropped', message: `Codex display name "${ir.harnessSpecific.codex.displayName}" has no CC equivalent — dropped` });
    features.push({ feature: 'Display metadata', status: 'dropped', percent: 0, notes: 'No CC equivalent for icons/brand' });
  }

  // Handle Cursor alwaysApply
  if (ir.harnessSpecific?.cursor?.alwaysApply && ir.activation.mode === 'always') {
    // In CC, alwaysApply equivalent is just not having disable-model-invocation
    warnings.push({ field: 'cursor.alwaysApply', level: 'native', message: 'alwaysApply mapped to always-loaded skill' });
  }

  // Generate SKILL.md
  const skillMd = serializeFrontmatter(fm, body);
  files.push({ path: path.join(skillDir, 'SKILL.md'), content: skillMd });

  // Copy scripts
  if (ir.scripts?.length) {
    for (const script of ir.scripts) {
      files.push({ path: path.join(skillDir, 'scripts', script.path), content: script.content });
    }
  }

  // Copy references
  if (ir.references?.length) {
    for (const ref of ir.references) {
      files.push({ path: path.join(skillDir, 'references', ref.path), content: ref.content });
    }
  }

  return { files, warnings, parity: buildParity(features, ir) };
}

/**
 * Emit a CLAUDE.md file from SkillIR (for rule/instruction conversion).
 */
export function emitClaudeMd(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];

  let content: string;
  if (ir.activation.globs?.length) {
    const fm: Record<string, unknown> = {};
    if (ir.description) fm['description'] = ir.description;
    fm['paths'] = ir.activation.globs;
    content = serializeFrontmatter(fm, ir.body);
  } else {
    content = ir.body;
  }

  warnings.push({ field: 'body', level: 'native', message: 'Content preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Content preserved' });

  const filePath = ir.activation.mode === 'always'
    ? path.join(outputDir, 'CLAUDE.md')
    : path.join(outputDir, '.claude', 'rules', `${ir.name}.md`);

  return {
    files: [{ path: filePath, content }],
    warnings,
    parity: buildParity(features, ir),
  };
}
