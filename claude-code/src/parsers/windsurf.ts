import * as fs from 'fs';
import type { SkillIR } from '../ir.js';

/**
 * Parse a Windsurf rules file (.windsurfrules or .windsurf/rules/*.md).
 */
export function parseWindsurfRules(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    name: 'windsurf-rules',
    description: 'Windsurf project rules',
    body: content,
    activation: { mode: 'always' },
    sourceFormat: 'windsurf',
    sourceFiles: [filePath],
  };
}
