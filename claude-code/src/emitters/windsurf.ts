import * as path from 'path';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit a Windsurf rules file from SkillIR.
 */
export function emitWindsurfRules(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];

  warnings.push({ field: 'body', level: 'native', message: 'Core content preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Plain markdown' });
  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: 'Always-applied' });

  let body = ir.body;

  // All advanced features are dropped for Windsurf (plain markdown only)
  if (ir.allowedTools?.length) {
    body += `\n\n<!-- SKILLPORT: Tool restrictions: ${ir.allowedTools.join(', ')} (not enforced in Windsurf) -->`;
    warnings.push({ field: 'allowed-tools', level: 'dropped', message: 'Tool restrictions not supported in Windsurf.' });
    features.push({ feature: 'Tool restrictions', status: 'dropped', percent: 0, notes: 'No Windsurf equivalent' });
  }
  if (ir.hooks?.length) {
    warnings.push({ field: 'hooks', level: 'dropped', message: `${ir.hooks.length} hooks dropped. Windsurf has no hook system.` });
    features.push({ feature: 'Hooks', status: 'dropped', percent: 0, notes: 'No hooks' });
  }
  if (ir.subagent?.enabled) {
    warnings.push({ field: 'subagent', level: 'dropped', message: 'Subagent isolation dropped.' });
    features.push({ feature: 'Subagent isolation', status: 'dropped', percent: 0, notes: 'No subagents' });
  }
  if (ir.dynamicContext?.length) {
    warnings.push({ field: 'dynamic-context', level: 'dropped', message: 'Dynamic context dropped.' });
    features.push({ feature: 'Dynamic context', status: 'dropped', percent: 0, notes: 'No preprocessing' });
  }
  if (ir.activation.globs?.length) {
    body += `\n\n<!-- SKILLPORT: Originally scoped to: ${ir.activation.globs.join(', ')} (Windsurf has no glob scoping) -->`;
    warnings.push({ field: 'globs', level: 'dropped', message: `Glob activation not supported in Windsurf. Content is always applied.` });
    features.push({ feature: 'Glob activation', status: 'dropped', percent: 0, notes: 'No glob support' });
  }

  // Windsurf uses plain markdown — either .windsurfrules or .windsurf/rules/
  return {
    files: [{ path: path.join(outputDir, '.windsurf', 'rules', `${ir.name}.md`), content: body }],
    warnings,
    parity: buildParity(features, ir),
  };
}
