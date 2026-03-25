import * as fs from 'fs';
import * as path from 'path';
import type { SkillIR } from '../ir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/**
 * Parse a GitHub Copilot instructions file.
 */
export function parseCopilotInstructions(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  // Root copilot-instructions.md has no frontmatter
  if (fileName === 'copilot-instructions.md') {
    return {
      name: 'copilot-instructions',
      description: 'GitHub Copilot project instructions',
      body: content,
      activation: { mode: 'always' },
      sourceFormat: 'copilot',
      sourceFiles: [filePath],
    };
  }

  // Non-root .instructions.md files have frontmatter
  const { frontmatter: fm, body } = parseFrontmatter(content);
  const name = fileName.replace('.instructions.md', '');
  const description = (fm['description'] as string) || '';
  const applyTo = parseApplyTo(fm['applyTo']);
  const excludeAgent = fm['excludeAgent'] as string | undefined;

  return {
    name,
    description,
    body,
    activation: {
      mode: applyTo.length ? 'glob' : 'always',
      globs: applyTo.length ? applyTo : undefined,
    },
    harnessSpecific: {
      copilot: { excludeAgent },
    },
    sourceFormat: 'copilot',
    sourceFiles: [filePath],
  };
}

function parseApplyTo(val: unknown): string[] {
  if (!val) return [];
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(val)) return val.map(String);
  return [];
}
