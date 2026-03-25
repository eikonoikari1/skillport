import * as path from 'path';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { serializeFrontmatter } from '../utils/frontmatter.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit an OpenClaw skill from SkillIR.
 */
export function emitOpenClawSkill(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];
  const files: { path: string; content: string }[] = [];

  const skillDir = path.join(outputDir, 'skills', ir.name);

  // Core fields
  warnings.push({ field: 'name, description, body', level: 'native', message: 'Core fields preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Markdown body preserved' });
  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: 'description-based discovery' });

  let body = ir.body;

  // Handle allowed-tools — OpenClaw has agent-level allow/deny but not skill-level
  if (ir.allowedTools?.length) {
    body = `**Tool restrictions:** This skill should only use: ${ir.allowedTools.join(', ')}\n\n${body}`;
    warnings.push({ field: 'allowed-tools', level: 'shimmed', message: `Tool restrictions shimmed as instruction. OpenClaw has agent-level tool policies but not per-skill restrictions.` });
    features.push({ feature: 'Tool restrictions', status: 'shimmed', percent: 50, notes: 'Instruction text, agent-level config available' });
  }

  // Handle hooks — OpenClaw has gateway-level hooks only
  if (ir.hooks?.length) {
    const gatewayMappable = ir.hooks.filter((h) => h.event === 'PreToolUse' && h.handler.type === 'command');
    const unmappable = ir.hooks.filter((h) => h.event !== 'PreToolUse' || h.handler.type !== 'command');

    if (gatewayMappable.length) {
      body += `\n\n<!-- SKILLPORT: ${gatewayMappable.length} hooks partially mappable to OpenClaw gateway hooks (command:new). Configure in OpenClaw gateway settings. -->`;
    }
    if (unmappable.length) {
      body += `\n\n<!-- SKILLPORT: ${unmappable.length} hooks have no OpenClaw equivalent:\n${unmappable.map((h) => `  ${h.event}(${h.matcher || '*'}): ${h.handler.type}`).join('\n')}\n-->`;
    }

    warnings.push({ field: 'hooks', level: 'dropped', message: `${ir.hooks.length} hooks have limited/no OpenClaw equivalent. Gateway-level command:new is the closest match for PreToolUse.` });
    features.push({ feature: 'Hooks', status: 'dropped', percent: gatewayMappable.length > 0 ? 15 : 0, notes: 'Gateway hooks only, tool:pre proposed but not shipped' });
  }

  // Handle subagent — no OpenClaw equivalent
  if (ir.subagent?.enabled) {
    body += `\n\n<!-- SKILLPORT: This skill uses subagent isolation (${ir.subagent.isolation}). OpenClaw has no native subagent primitive. Consider multi-agent config or community skills for approximation. -->`;
    warnings.push({ field: 'subagent', level: 'dropped', message: 'Subagent isolation has no OpenClaw equivalent. Annotated for manual adaptation.' });
    features.push({ feature: 'Subagent isolation', status: 'dropped', percent: 0, notes: 'No native subagent primitive' });
  }

  // Handle dynamic context — emit as preamble bash block (clearshot pattern)
  if (ir.dynamicContext?.length) {
    const preamble = ir.dynamicContext.map((ctx) =>
      `# Dynamic context: ${ctx.placeholder}\n${ctx.placeholder.replace(/^!`/, '').replace(/`$/, '')}=$(${ctx.command} 2>/dev/null || echo "[unavailable]")\necho "${ctx.placeholder}: $${ctx.placeholder.replace(/[^a-zA-Z0-9_]/g, '_')}"`
    ).join('\n\n');

    body = `## Preamble\n\nRun this bash block first:\n\n\`\`\`bash\n${preamble}\n\`\`\`\n\n${body}`;
    warnings.push({ field: 'dynamic-context', level: 'shimmed', message: 'Dynamic context converted to preamble bash block (following clearshot pattern). Agent must execute it at start.' });
    features.push({ feature: 'Dynamic context', status: 'shimmed', percent: 40, notes: 'Preamble bash block' });
  }

  // Handle model/effort
  if (ir.model) {
    warnings.push({ field: 'model', level: 'dropped', message: `Model override "${ir.model}" dropped. Set via OpenClaw provider config.` });
    features.push({ feature: 'Model override', status: 'dropped', percent: 0, notes: 'Use provider config' });
  }

  // Handle glob activation — no OpenClaw equivalent
  if (ir.activation.globs?.length) {
    warnings.push({ field: 'activation.globs', level: 'dropped', message: `Glob activation (${ir.activation.globs.join(', ')}) not supported. Skill is always available when loaded.` });
    features.push({ feature: 'Glob activation', status: 'dropped', percent: 0, notes: 'No glob support' });
  }

  // Build SKILL.md
  const fm: Record<string, unknown> = {
    name: ir.name,
    description: ir.description,
  };
  if (ir.version) fm['version'] = ir.version;
  if (ir.harnessSpecific?.openclaw?.channels) {
    fm['channels'] = ir.harnessSpecific.openclaw.channels;
  }

  const skillMd = serializeFrontmatter(fm, body);
  files.push({ path: path.join(skillDir, 'SKILL.md'), content: skillMd });

  // Copy scripts and references
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

  return { files, warnings, parity: buildParity(features, ir) };
}
