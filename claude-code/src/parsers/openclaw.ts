import * as fs from 'fs';
import * as path from 'path';
import type { SkillIR } from '../ir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/**
 * Parse an OpenClaw skill directory.
 */
export function parseOpenClawSkill(skillDir: string): SkillIR {
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
    harnessSpecific: {
      openclaw: {
        channels: fm['channels'] as string[] | undefined,
      },
    },
    sourceFormat: 'openclaw',
    sourceFiles: [skillMdPath],
  };
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
