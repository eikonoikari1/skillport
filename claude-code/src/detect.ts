import * as fs from 'fs';
import * as path from 'path';
import type { HarnessType } from './ir.js';
import { parseFrontmatter } from './utils/frontmatter.js';

export interface DetectionResult {
  harness: HarnessType;
  confidence: 'high' | 'medium' | 'low';
  files: string[];
  reason: string;
}

/**
 * Auto-detect the harness format of a skill/rule at the given path.
 */
export function detectFormat(targetPath: string): DetectionResult | null {
  const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
  if (!stat) return null;

  const isDir = stat.isDirectory();
  const dir = isDir ? targetPath : path.dirname(targetPath);
  const fileName = isDir ? '' : path.basename(targetPath);

  // Check explicit file type first
  if (fileName.endsWith('.mdc')) {
    return { harness: 'cursor', confidence: 'high', files: [targetPath], reason: '.mdc extension' };
  }
  if (fileName === '.cursorrules') {
    return { harness: 'cursor', confidence: 'high', files: [targetPath], reason: '.cursorrules file' };
  }
  if (fileName === 'CLAUDE.md') {
    return { harness: 'claude', confidence: 'high', files: [targetPath], reason: 'CLAUDE.md file' };
  }
  if (fileName === 'AGENTS.md') {
    return { harness: 'codex', confidence: 'high', files: [targetPath], reason: 'AGENTS.md file' };
  }
  if (fileName === '.windsurfrules') {
    return { harness: 'windsurf', confidence: 'high', files: [targetPath], reason: '.windsurfrules file' };
  }

  // Check path patterns
  const normalized = targetPath.replace(/\\/g, '/');

  if (normalized.includes('.cursor/rules/') || normalized.includes('.cursor/skills/')) {
    return { harness: 'cursor', confidence: 'high', files: [targetPath], reason: '.cursor/ directory path' };
  }
  if (normalized.includes('.claude/skills/') || normalized.includes('.claude/rules/')) {
    return detectClaudeSkill(dir, targetPath);
  }
  if (normalized.includes('.agents/skills/')) {
    return detectAgentsSkill(dir, targetPath);
  }
  if (normalized.includes('.github/instructions/') || normalized.includes('.github/copilot-instructions.md')) {
    return { harness: 'copilot', confidence: 'high', files: [targetPath], reason: '.github/ copilot path' };
  }
  if (normalized.includes('.windsurf/rules/')) {
    return { harness: 'windsurf', confidence: 'high', files: [targetPath], reason: '.windsurf/ directory path' };
  }
  if (normalized.includes('.openclaw/skills/') || normalized.includes('openclaw/skills/')) {
    return { harness: 'openclaw', confidence: 'high', files: [targetPath], reason: 'OpenClaw skill path' };
  }

  // If it's a directory with SKILL.md, inspect the frontmatter
  if (isDir) {
    const skillMd = path.join(dir, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      return detectFromSkillMd(skillMd, dir);
    }
  }

  // If it's a SKILL.md file directly
  if (fileName === 'SKILL.md') {
    return detectFromSkillMd(targetPath, dir);
  }

  return null;
}

function detectClaudeSkill(dir: string, targetPath: string): DetectionResult {
  const files = collectSkillFiles(dir);
  return { harness: 'claude', confidence: 'high', files: files.length ? files : [targetPath], reason: '.claude/ directory path' };
}

function detectAgentsSkill(dir: string, targetPath: string): DetectionResult {
  // Could be Codex or universal. Check for openai.yaml
  const hasOpenaiYaml = fs.existsSync(path.join(dir, 'agents', 'openai.yaml'))
    || fs.existsSync(path.join(dir, 'openai.yaml'));
  if (hasOpenaiYaml) {
    return { harness: 'codex', confidence: 'high', files: [targetPath], reason: 'openai.yaml present' };
  }
  // Default .agents/skills to codex format (universal)
  return { harness: 'codex', confidence: 'medium', files: [targetPath], reason: '.agents/skills/ directory (universal)' };
}

function detectFromSkillMd(skillMdPath: string, dir: string): DetectionResult {
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter } = parseFrontmatter(content);
  const files = collectSkillFiles(dir);

  // Claude-specific frontmatter fields
  if (frontmatter['allowed-tools'] || frontmatter['context'] || frontmatter['hooks']
    || frontmatter['disable-model-invocation'] || frontmatter['user-invocable']
    || frontmatter['effort'] || frontmatter['agent']) {
    return { harness: 'claude', confidence: 'high', files, reason: 'Claude-specific frontmatter fields' };
  }

  // Check for openai.yaml (Codex-specific)
  if (fs.existsSync(path.join(dir, 'agents', 'openai.yaml'))
    || fs.existsSync(path.join(dir, 'openai.yaml'))) {
    return { harness: 'codex', confidence: 'high', files, reason: 'openai.yaml present' };
  }

  // Generic SKILL.md — default to claude since it's the originator
  return { harness: 'claude', confidence: 'low', files, reason: 'Generic SKILL.md (defaulting to Claude)' };
}

function collectSkillFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      files.push(full);
    } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...collectSkillFiles(full));
    }
  }
  return files;
}

/**
 * Scan a project directory for all detectable harness configs.
 */
export function scanProject(projectDir: string): DetectionResult[] {
  const results: DetectionResult[] = [];
  const checks = [
    { path: 'CLAUDE.md', harness: 'claude' as HarnessType },
    { path: 'AGENTS.md', harness: 'codex' as HarnessType },
    { path: '.cursorrules', harness: 'cursor' as HarnessType },
    { path: '.windsurfrules', harness: 'windsurf' as HarnessType },
    { path: '.github/copilot-instructions.md', harness: 'copilot' as HarnessType },
  ];

  for (const check of checks) {
    const full = path.join(projectDir, check.path);
    if (fs.existsSync(full)) {
      results.push({ harness: check.harness, confidence: 'high', files: [full], reason: `Found ${check.path}` });
    }
  }

  // Check for skill directories
  const skillDirs = [
    { dir: '.claude/skills', harness: 'claude' as HarnessType },
    { dir: '.cursor/skills', harness: 'cursor' as HarnessType },
    { dir: '.cursor/rules', harness: 'cursor' as HarnessType },
    { dir: '.agents/skills', harness: 'codex' as HarnessType },
    { dir: '.windsurf/rules', harness: 'windsurf' as HarnessType },
    { dir: '.github/instructions', harness: 'copilot' as HarnessType },
  ];

  for (const { dir, harness } of skillDirs) {
    const full = path.join(projectDir, dir);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      const entries = fs.readdirSync(full);
      if (entries.length > 0) {
        results.push({ harness, confidence: 'high', files: entries.map((e) => path.join(full, e)), reason: `Found ${dir}/ with ${entries.length} entries` });
      }
    }
  }

  return results;
}
