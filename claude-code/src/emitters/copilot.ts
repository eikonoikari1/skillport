import * as path from 'path';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { serializeFrontmatter } from '../utils/frontmatter.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit a GitHub Copilot instructions file from SkillIR.
 */
export function emitCopilotInstructions(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];

  warnings.push({ field: 'name, description, body', level: 'native', message: 'Core fields preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Content preserved' });

  let body = ir.body;

  // Shim non-portable features as annotations
  if (ir.allowedTools?.length) {
    body += `\n\n<!-- SKILLPORT: Tool restrictions: ${ir.allowedTools.join(', ')} -->`;
    warnings.push({ field: 'allowed-tools', level: 'dropped', message: 'Tool restrictions not supported in Copilot. Annotated as comment.' });
    features.push({ feature: 'Tool restrictions', status: 'dropped', percent: 0, notes: 'No Copilot equivalent' });
  }
  if (ir.hooks?.length) {
    warnings.push({ field: 'hooks', level: 'dropped', message: `${ir.hooks.length} hooks dropped. Copilot has no hook system.` });
    features.push({ feature: 'Hooks', status: 'dropped', percent: 0, notes: 'No Copilot hooks' });
  }
  if (ir.subagent?.enabled) {
    warnings.push({ field: 'subagent', level: 'dropped', message: 'Subagent isolation dropped. Copilot has no subagent system.' });
    features.push({ feature: 'Subagent isolation', status: 'dropped', percent: 0, notes: 'No Copilot subagents' });
  }
  if (ir.dynamicContext?.length) {
    warnings.push({ field: 'dynamic-context', level: 'dropped', message: 'Dynamic context dropped. Copilot has no preprocessing.' });
    features.push({ feature: 'Dynamic context', status: 'dropped', percent: 0, notes: 'No preprocessing' });
  }

  // Determine output format
  if (ir.activation.mode === 'always') {
    // Root copilot-instructions.md — no frontmatter
    features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: 'Always-applied root file' });
    return {
      files: [{ path: path.join(outputDir, '.github', 'copilot-instructions.md'), content: body }],
      warnings,
      parity: buildParity(features, ir),
    };
  }

  // Non-root instruction file with frontmatter
  const fm: Record<string, unknown> = {};
  if (ir.description) fm['description'] = ir.description;
  if (ir.activation.globs?.length) {
    fm['applyTo'] = ir.activation.globs.join(', ');
    features.push({ feature: 'Glob activation', status: 'native', percent: 100, notes: 'applyTo field' });
  }
  if (ir.harnessSpecific?.copilot?.excludeAgent) {
    fm['excludeAgent'] = ir.harnessSpecific.copilot.excludeAgent;
  }

  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: 'description + applyTo' });

  const content = serializeFrontmatter(fm, body);
  return {
    files: [{ path: path.join(outputDir, '.github', 'instructions', `${ir.name}.instructions.md`), content }],
    warnings,
    parity: buildParity(features, ir),
  };
}
