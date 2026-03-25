import * as fs from 'fs';
import * as path from 'path';
import type { SkillIR } from '../ir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/**
 * Parse a Codex CLI skill directory (.agents/skills/<name>/).
 */
export function parseCodexSkill(skillDir: string): SkillIR {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter: fm, body } = parseFrontmatter(content);

  const name = (fm['name'] as string) || path.basename(skillDir);
  const description = (fm['description'] as string) || '';

  // Check for openai.yaml
  const openaiYaml = loadOpenaiYaml(skillDir);

  const scripts = collectDir(path.join(skillDir, 'scripts'));
  const references = collectDir(path.join(skillDir, 'references'));

  return {
    name,
    description,
    version: fm['version'] as string | undefined,
    body,
    activation: {
      mode: openaiYaml?.allowImplicitInvocation === false ? 'explicit' : 'intelligent',
      triggerKeyword: `$${name}`,
    },
    scripts: scripts.length ? scripts : undefined,
    references: references.length ? references : undefined,
    harnessSpecific: {
      codex: openaiYaml ? {
        allowImplicitInvocation: openaiYaml.allowImplicitInvocation,
        displayName: openaiYaml.displayName,
        iconSmall: openaiYaml.iconSmall,
        iconLarge: openaiYaml.iconLarge,
        brandColor: openaiYaml.brandColor,
      } : undefined,
    },
    sourceFormat: 'codex',
    sourceFiles: [skillMdPath],
  };
}

/**
 * Parse an AGENTS.md file.
 */
export function parseAgentsMd(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    name: 'agents-instructions',
    description: 'Project instructions from AGENTS.md',
    body: content,
    activation: { mode: 'always' },
    sourceFormat: 'codex',
    sourceFiles: [filePath],
  };
}

interface OpenaiYamlData {
  allowImplicitInvocation?: boolean;
  displayName?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
}

function loadOpenaiYaml(skillDir: string): OpenaiYamlData | null {
  const candidates = [
    path.join(skillDir, 'agents', 'openai.yaml'),
    path.join(skillDir, 'openai.yaml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const YAML = require('yaml');
        const data = YAML.parse(fs.readFileSync(candidate, 'utf-8'));
        return {
          allowImplicitInvocation: data?.policy?.allow_implicit_invocation,
          displayName: data?.interface?.display_name,
          iconSmall: data?.interface?.icon_small,
          iconLarge: data?.interface?.icon_large,
          brandColor: data?.interface?.brand_color,
        };
      } catch {
        return null;
      }
    }
  }
  return null;
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
