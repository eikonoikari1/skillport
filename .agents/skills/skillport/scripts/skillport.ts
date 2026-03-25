#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';

import type { SkillIR, HarnessType, ConversionResult } from '../src/ir.js';
import { HarnessTypes } from '../src/ir.js';
import { detectFormat, scanProject } from '../src/detect.js';
import { formatReport } from '../src/utils/warnings.js';

// Parsers
import { parseClaudeSkill, parseClaudeMd } from '../src/parsers/claude.js';
import { parseCursorMdc, parseCursorrules, parseCursorSkill } from '../src/parsers/cursor.js';
import { parseCodexSkill, parseAgentsMd } from '../src/parsers/codex.js';
import { parseOpenClawSkill } from '../src/parsers/openclaw.js';
import { parseCopilotInstructions } from '../src/parsers/copilot.js';
import { parseWindsurfRules } from '../src/parsers/windsurf.js';

// Emitters
import { emitClaudeSkill, emitClaudeMd } from '../src/emitters/claude.js';
import { emitCursorSkill } from '../src/emitters/cursor.js';
import { emitCodexSkill, emitAgentsMd } from '../src/emitters/codex.js';
import { emitOpenClawSkill } from '../src/emitters/openclaw.js';
import { emitCopilotInstructions } from '../src/emitters/copilot.js';
import { emitWindsurfRules } from '../src/emitters/windsurf.js';

program
  .name('skillport')
  .description('Universal skill/rule adapter across AI coding harnesses')
  .version('0.1.0');

program
  .command('convert')
  .description('Convert a skill/rule between harness formats')
  .argument('<source>', 'Path to skill directory, rule file, or instruction file')
  .option('--to <harnesses>', 'Target harness(es): claude,cursor,codex,openclaw,copilot,windsurf,all', 'all')
  .option('--from <harness>', 'Source harness (auto-detected if omitted)')
  .option('--output <dir>', 'Output directory (default: current directory)', '.')
  .option('--dry-run', 'Show what would be generated without writing', false)
  .action(async (source: string, opts: { to: string; from?: string; output: string; dryRun: boolean }) => {
    const sourcePath = path.resolve(source);

    if (!fs.existsSync(sourcePath)) {
      console.error(chalk.red(`Source not found: ${sourcePath}`));
      process.exit(1);
    }

    // Detect source format
    let fromHarness: HarnessType;
    if (opts.from) {
      if (!HarnessTypes.includes(opts.from as HarnessType)) {
        console.error(chalk.red(`Unknown harness: ${opts.from}. Valid: ${HarnessTypes.join(', ')}`));
        process.exit(1);
      }
      fromHarness = opts.from as HarnessType;
    } else {
      const detected = detectFormat(sourcePath);
      if (!detected) {
        console.error(chalk.red(`Could not auto-detect format for: ${sourcePath}`));
        console.error('Use --from to specify the source harness.');
        process.exit(1);
      }
      fromHarness = detected.harness;
      console.log(chalk.dim(`Detected source format: ${fromHarness} (${detected.reason})`));
    }

    // Parse source
    const ir = parseSource(sourcePath, fromHarness);
    if (!ir) {
      console.error(chalk.red('Failed to parse source'));
      process.exit(1);
    }

    console.log(chalk.bold(`\nConverting: ${ir.name}`));
    console.log(chalk.dim(`  From: ${fromHarness}`));

    // Determine targets
    const targets = opts.to === 'all'
      ? HarnessTypes.filter((h) => h !== fromHarness)
      : opts.to.split(',').map((t) => t.trim()) as HarnessType[];

    console.log(chalk.dim(`  To:   ${targets.join(', ')}`));
    console.log('');

    const outputDir = path.resolve(opts.output);

    for (const target of targets) {
      if (!HarnessTypes.includes(target)) {
        console.error(chalk.yellow(`Skipping unknown harness: ${target}`));
        continue;
      }

      const result = emitTarget(ir, target, outputDir);
      if (!result) {
        console.error(chalk.yellow(`No emitter for: ${target}`));
        continue;
      }

      if (opts.dryRun) {
        console.log(chalk.cyan(`\n[DRY RUN] Would generate for ${target}:`));
        for (const file of result.files) {
          console.log(chalk.dim(`  ${file.path}`));
        }
      } else {
        for (const file of result.files) {
          const dir = path.dirname(file.path);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file.path, file.content, 'utf-8');
        }
      }

      // Print report
      const report = formatReport(
        ir.name,
        fromHarness,
        target,
        sourcePath,
        result.files[0]?.path || '',
        result.warnings,
        result.parity
      );
      console.log('');
      console.log(report);
      console.log(chalk.dim('─'.repeat(60)));
    }
  });

program
  .command('detect')
  .description('Scan a project directory for all harness configs')
  .argument('[dir]', 'Directory to scan', '.')
  .action((dir: string) => {
    const projectDir = path.resolve(dir);
    const results = scanProject(projectDir);

    if (results.length === 0) {
      console.log(chalk.yellow('No harness configurations detected.'));
      return;
    }

    console.log(chalk.bold(`\nDetected harness configs in ${projectDir}:\n`));

    for (const result of results) {
      const icon = result.confidence === 'high' ? '✓' : result.confidence === 'medium' ? '~' : '?';
      console.log(`  ${icon} ${chalk.cyan(result.harness.padEnd(10))} ${result.reason}`);
      for (const file of result.files.slice(0, 3)) {
        console.log(chalk.dim(`    ${path.relative(projectDir, file)}`));
      }
      if (result.files.length > 3) {
        console.log(chalk.dim(`    ... and ${result.files.length - 3} more`));
      }
    }

    console.log('');
  });

program.parse();

// ─── Helpers ──────────────────────────────────────────────

function parseSource(sourcePath: string, harness: HarnessType): SkillIR | null {
  const stat = fs.statSync(sourcePath);
  const isDir = stat.isDirectory();
  const fileName = isDir ? '' : path.basename(sourcePath);

  try {
    switch (harness) {
      case 'claude':
        if (isDir) return parseClaudeSkill(sourcePath);
        if (fileName === 'CLAUDE.md') return parseClaudeMd(sourcePath);
        if (fileName === 'SKILL.md') return parseClaudeSkill(path.dirname(sourcePath));
        return parseClaudeMd(sourcePath);

      case 'cursor':
        if (isDir) return parseCursorSkill(sourcePath);
        if (fileName.endsWith('.mdc')) return parseCursorMdc(sourcePath);
        if (fileName === '.cursorrules') return parseCursorrules(sourcePath);
        if (fileName === 'SKILL.md') return parseCursorSkill(path.dirname(sourcePath));
        return parseCursorMdc(sourcePath);

      case 'codex':
        if (isDir) return parseCodexSkill(sourcePath);
        if (fileName === 'AGENTS.md') return parseAgentsMd(sourcePath);
        if (fileName === 'SKILL.md') return parseCodexSkill(path.dirname(sourcePath));
        return parseAgentsMd(sourcePath);

      case 'openclaw':
        if (isDir) return parseOpenClawSkill(sourcePath);
        if (fileName === 'SKILL.md') return parseOpenClawSkill(path.dirname(sourcePath));
        return parseOpenClawSkill(path.dirname(sourcePath));

      case 'copilot':
        return parseCopilotInstructions(sourcePath);

      case 'windsurf':
        return parseWindsurfRules(sourcePath);

      default:
        return null;
    }
  } catch (err) {
    console.error(chalk.red(`Parse error: ${err}`));
    return null;
  }
}

function emitTarget(ir: SkillIR, target: HarnessType, outputDir: string): ConversionResult | null {
  const isRuleType = ir.activation.mode === 'always' && !ir.scripts?.length && !ir.references?.length;

  switch (target) {
    case 'claude':
      return isRuleType ? emitClaudeMd(ir, outputDir) : emitClaudeSkill(ir, outputDir);
    case 'cursor':
      return emitCursorSkill(ir, outputDir);
    case 'codex':
      return isRuleType ? emitAgentsMd(ir, outputDir) : emitCodexSkill(ir, outputDir);
    case 'openclaw':
      return emitOpenClawSkill(ir, outputDir);
    case 'copilot':
      return emitCopilotInstructions(ir, outputDir);
    case 'windsurf':
      return emitWindsurfRules(ir, outputDir);
    default:
      return null;
  }
}
