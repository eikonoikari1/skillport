import * as fs from 'fs';
import * as path from 'path';
import type { SkillIR } from '../ir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/**
 * Parse a Cursor .mdc rule file.
 */
export function parseCursorMdc(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter: fm, body } = parseFrontmatter(content);

  const name = path.basename(filePath, '.mdc');
  const description = (fm['description'] as string) || '';
  const alwaysApply = fm['alwaysApply'] === true;
  const globs = parseGlobs(fm['globs']);

  let mode: SkillIR['activation']['mode'];
  if (alwaysApply) {
    mode = 'always';
  } else if (globs.length > 0) {
    mode = 'glob';
  } else if (description) {
    mode = 'intelligent';
  } else {
    mode = 'manual';
  }

  return {
    name,
    description,
    body,
    activation: { mode, globs: globs.length ? globs : undefined },
    harnessSpecific: {
      cursor: { alwaysApply: alwaysApply || undefined },
    },
    sourceFormat: 'cursor',
    sourceFiles: [filePath],
  };
}

/**
 * Parse a legacy .cursorrules file.
 */
export function parseCursorrules(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    name: 'cursorrules',
    description: 'Legacy Cursor rules',
    body: content,
    activation: { mode: 'always' },
    harnessSpecific: { cursor: { alwaysApply: true } },
    sourceFormat: 'cursor',
    sourceFiles: [filePath],
  };
}

/**
 * Parse a Cursor skill directory (.cursor/skills/<name>/).
 */
export function parseCursorSkill(skillDir: string): SkillIR {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter: fm, body } = parseFrontmatter(content);

  const name = (fm['name'] as string) || path.basename(skillDir);
  const description = (fm['description'] as string) || '';

  const scripts = collectDir(path.join(skillDir, 'scripts'));
  const references = collectDir(path.join(skillDir, 'references'));

  return {
    name,
    description,
    version: fm['version'] as string | undefined,
    body,
    activation: { mode: 'intelligent' },
    scripts: scripts.length ? scripts : undefined,
    references: references.length ? references : undefined,
    sourceFormat: 'cursor',
    sourceFiles: [skillMdPath],
  };
}

function parseGlobs(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    return val.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function collectDir(dir: string): { path: string; content: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      try {
        return { path: e.name, content: fs.readFileSync(path.join(dir, e.name), 'utf-8') };
      } catch {
        return null;
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}
