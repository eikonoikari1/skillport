import * as path from 'path';
import YAML from 'yaml';
import type { SkillIR, ConversionResult, ConversionWarning, FeatureParity } from '../ir.js';
import { serializeFrontmatter } from '../utils/frontmatter.js';
import { buildParity } from '../utils/warnings.js';

/**
 * Emit a Codex CLI skill from SkillIR.
 */
export function emitCodexSkill(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];
  const files: { path: string; content: string }[] = [];

  const skillDir = path.join(outputDir, '.agents', 'skills', ir.name);

  // Core fields — native
  warnings.push({ field: 'name, description, body', level: 'native', message: 'Core fields preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Markdown body preserved' });
  features.push({ feature: 'Activation trigger', status: 'native', percent: 100, notes: 'description-based discovery' });

  let body = ir.body;

  // Handle allowed-tools — shimmed as instruction
  if (ir.allowedTools?.length) {
    body = `**Tool restrictions:** This skill should only use: ${ir.allowedTools.join(', ')}\n\n${body}`;
    warnings.push({ field: 'allowed-tools', level: 'shimmed', message: `allowed-tools shimmed as instruction text. Codex uses OS sandbox for security, not per-skill tool lists.` });
    features.push({ feature: 'Tool restrictions', status: 'shimmed', percent: 60, notes: 'Instruction text only, Codex uses OS sandbox' });
  }

  // Handle hooks — no Codex equivalent
  if (ir.hooks?.length) {
    const hookSummary = ir.hooks.map((h) => `${h.event}(${h.matcher || '*'}): ${h.handler.type}`).join(', ');

    // Generate wrapper scripts for command-type hooks
    const commandHooks = ir.hooks.filter((h) => h.handler.type === 'command');
    if (commandHooks.length) {
      for (const hook of commandHooks) {
        const scriptName = `hook-${hook.event.toLowerCase()}.sh`;
        files.push({
          path: path.join(skillDir, 'scripts', scriptName),
          content: `#!/bin/bash\n# SKILLPORT: Emulated hook for ${hook.event}(${hook.matcher || '*'})\n# In Claude Code, this ran automatically. Here you must invoke it manually.\n${hook.handler.value}\n`,
        });
      }
      body += `\n\n<!-- SKILLPORT: This skill had ${commandHooks.length} hooks that ran automatically in Claude Code. Wrapper scripts are in scripts/. Run them manually as needed. -->`;
    }

    warnings.push({ field: 'hooks', level: 'dropped', message: `${ir.hooks.length} hooks (${hookSummary}) have no Codex equivalent. ${commandHooks.length} command hooks converted to wrapper scripts in scripts/.` });
    features.push({ feature: 'Hooks', status: 'dropped', percent: commandHooks.length > 0 ? 20 : 0, notes: `No native hooks. ${commandHooks.length} converted to scripts.` });
  }

  // Handle subagent — Codex has fork command
  if (ir.subagent?.enabled) {
    body += `\n\n<!-- SKILLPORT: This skill uses subagent isolation. In Codex, use the \`fork\` command to spawn a subprocess. -->`;
    warnings.push({ field: 'subagent', level: 'shimmed', message: `Subagent isolation shimmed. Codex supports \`fork\` command but config differs from Claude Code's context:fork.` });
    features.push({ feature: 'Subagent isolation', status: 'shimmed', percent: 50, notes: 'Codex fork command, manual invocation' });
  }

  // Handle dynamic context — generate preprocessor
  if (ir.dynamicContext?.length) {
    const renderScript = generatePreprocessor(ir.dynamicContext, skillDir);
    files.push({ path: path.join(skillDir, 'scripts', 'render-context.sh'), content: renderScript });
    body = `**Note:** Run \`scripts/render-context.sh\` before first use to inject dynamic context.\n\n${body}`;
    warnings.push({ field: 'dynamic-context', level: 'shimmed', message: `${ir.dynamicContext.length} dynamic context commands converted to preprocessor script. Must run manually before Codex launch.` });
    features.push({ feature: 'Dynamic context', status: 'shimmed', percent: 30, notes: 'Preprocessor script, run before launch' });
  }

  // Model/effort — no Codex equivalent
  if (ir.model) {
    warnings.push({ field: 'model', level: 'dropped', message: `Model override "${ir.model}" dropped. Set via Codex config.toml instead.` });
    features.push({ feature: 'Model override', status: 'dropped', percent: 0, notes: 'Use config.toml model setting' });
  }

  // Handle glob activation — no Codex equivalent
  if (ir.activation.globs?.length) {
    body += `\n\n<!-- SKILLPORT: This skill was glob-activated for: ${ir.activation.globs.join(', ')}. Codex does not support glob-based activation. The skill will always be available. -->`;
    warnings.push({ field: 'activation.globs', level: 'shimmed', message: `Glob patterns (${ir.activation.globs.join(', ')}) annotated but not enforced. Codex loads skills by description match, not file patterns.` });
    features.push({ feature: 'Glob activation', status: 'shimmed', percent: 30, notes: 'Annotated, not enforced' });
  }

  // Build SKILL.md
  const fm: Record<string, unknown> = {
    name: ir.name,
    description: ir.description,
  };
  if (ir.version) fm['version'] = ir.version;

  const skillMd = serializeFrontmatter(fm, body);
  files.push({ path: path.join(skillDir, 'SKILL.md'), content: skillMd });

  // Generate openai.yaml if there's Codex-specific metadata or we want to preserve activation config
  const codexMeta = ir.harnessSpecific?.codex;
  if (codexMeta || ir.activation.mode === 'explicit') {
    const openaiYaml: Record<string, unknown> = {};

    if (codexMeta?.displayName || codexMeta?.iconSmall || codexMeta?.brandColor) {
      openaiYaml['interface'] = {
        ...(codexMeta.displayName ? { display_name: codexMeta.displayName } : {}),
        ...(codexMeta.iconSmall ? { icon_small: codexMeta.iconSmall } : {}),
        ...(codexMeta.iconLarge ? { icon_large: codexMeta.iconLarge } : {}),
        ...(codexMeta.brandColor ? { brand_color: codexMeta.brandColor } : {}),
      };
    }

    if (ir.activation.mode === 'explicit' || codexMeta?.allowImplicitInvocation === false) {
      openaiYaml['policy'] = { allow_implicit_invocation: false };
    }

    if (Object.keys(openaiYaml).length) {
      files.push({
        path: path.join(skillDir, 'agents', 'openai.yaml'),
        content: YAML.stringify(openaiYaml),
      });
    }
  }

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

  return { files, warnings, parity: buildParity(features, ir) };
}

/**
 * Emit an AGENTS.md file from SkillIR (for rule/instruction conversion).
 */
export function emitAgentsMd(ir: SkillIR, outputDir: string): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const features: FeatureParity[] = [];

  let content = ir.body;

  // Annotate globs as comments
  if (ir.activation.globs?.length) {
    content = `*Applies to: ${ir.activation.globs.join(', ')}*\n\n${content}`;
    warnings.push({ field: 'globs', level: 'shimmed', message: 'Glob patterns preserved as italic annotation for human reference' });
    features.push({ feature: 'Glob activation', status: 'shimmed', percent: 30, notes: 'Annotation only' });
  }

  warnings.push({ field: 'body', level: 'native', message: 'Content preserved' });
  features.push({ feature: 'Core instructions', status: 'native', percent: 100, notes: 'Content preserved' });

  return {
    files: [{ path: path.join(outputDir, 'AGENTS.md'), content }],
    warnings,
    parity: buildParity(features, ir),
  };
}

function generatePreprocessor(contexts: { placeholder: string; command: string }[], _skillDir: string): string {
  const lines = [
    '#!/bin/bash',
    '# Generated by skillport — preprocessor for dynamic context',
    '# Run before launching Codex to inject live data',
    '',
    'SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    'SKILL_FILE="$SKILL_DIR/SKILL.md"',
    '',
  ];

  for (const ctx of contexts) {
    const escaped = ctx.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    lines.push(`RESULT=$(${ctx.command} 2>/dev/null || echo "[command failed]")`);
    lines.push(`sed -i '' "s|${escaped}|$RESULT|g" "$SKILL_FILE"`);
    lines.push('');
  }

  lines.push('echo "Dynamic context rendered for Codex"');
  return lines.join('\n');
}
