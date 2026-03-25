import * as fs from 'fs';
import * as path from 'path';
import type { SkillIR, HookIR, DynamicContextIR, FileEntry } from '../ir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/**
 * Parse a Claude Code skill directory (SKILL.md + scripts/ + references/).
 */
export function parseClaudeSkill(skillDir: string): SkillIR {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter: fm, body } = parseFrontmatter(content);

  const name = (fm['name'] as string) || path.basename(skillDir);
  const description = (fm['description'] as string) || '';

  // Parse activation mode
  const disableModelInvocation = fm['disable-model-invocation'] === true;
  const userInvocable = fm['user-invocable'] !== false; // default true
  let mode: SkillIR['activation']['mode'] = 'intelligent';
  if (disableModelInvocation && userInvocable) mode = 'explicit';
  else if (disableModelInvocation && !userInvocable) mode = 'manual';

  // Parse allowed-tools
  const allowedTools = parseStringArray(fm['allowed-tools']);

  // Parse hooks from frontmatter
  const hooks = parseHooks(fm['hooks'] as Record<string, unknown> | undefined);

  // Parse subagent config
  const contextVal = fm['context'] as string | undefined;
  const agentVal = fm['agent'] as string | undefined;
  const subagent = contextVal === 'fork' ? {
    enabled: true,
    agentType: agentVal,
    isolation: 'fork' as const,
  } : undefined;

  // Extract dynamic context (!`command`) from body
  const dynamicContext = extractDynamicContext(body);

  // Collect scripts and references
  const scripts = collectFiles(path.join(skillDir, 'scripts'));
  const references = collectFiles(path.join(skillDir, 'references'));

  // Also collect bin/ as scripts
  scripts.push(...collectFiles(path.join(skillDir, 'bin')));

  return {
    name,
    description,
    version: fm['version'] as string | undefined,
    body,
    activation: {
      mode,
      triggerKeyword: `/${name}`,
    },
    allowedTools: allowedTools.length ? allowedTools : undefined,
    hooks: hooks.length ? hooks : undefined,
    subagent,
    dynamicContext: dynamicContext.length ? dynamicContext : undefined,
    model: fm['model'] as string | undefined,
    effort: fm['effort'] as string | undefined,
    scripts: scripts.length ? scripts : undefined,
    references: references.length ? references : undefined,
    harnessSpecific: {
      claude: {
        disableModelInvocation: disableModelInvocation || undefined,
        userInvocable: userInvocable === false ? false : undefined,
      },
    },
    sourceFormat: 'claude',
    sourceFiles: [skillMdPath],
  };
}

/**
 * Parse a CLAUDE.md file as a rule/instruction set.
 */
export function parseClaudeMd(filePath: string): SkillIR {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter: fm, body } = parseFrontmatter(content);

  const name = fm['name'] as string || 'project-instructions';
  const globs = parseStringArray(fm['paths'] || fm['globs']);

  return {
    name,
    description: (fm['description'] as string) || 'Project instructions from CLAUDE.md',
    body,
    activation: {
      mode: globs.length ? 'glob' : 'always',
      globs: globs.length ? globs : undefined,
    },
    sourceFormat: 'claude',
    sourceFiles: [filePath],
  };
}

function parseHooks(hooksObj: Record<string, unknown> | undefined): HookIR[] {
  if (!hooksObj) return [];
  const result: HookIR[] = [];

  for (const [event, handlers] of Object.entries(hooksObj)) {
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      const h = handler as Record<string, unknown>;
      const matcher = h['matcher'] as string | undefined;
      const hooksList = h['hooks'] as Array<Record<string, unknown>> | undefined;
      if (!hooksList) continue;

      for (const hook of hooksList) {
        result.push({
          event,
          matcher,
          handler: {
            type: (hook['type'] as HookIR['handler']['type']) || 'command',
            value: (hook['command'] || hook['url'] || hook['prompt'] || '') as string,
            timeout: hook['timeout'] as number | undefined,
          },
          canBlock: event.startsWith('Pre') || event === 'Stop' || event === 'PermissionRequest',
        });
      }
    }
  }

  return result;
}

function extractDynamicContext(body: string): DynamicContextIR[] {
  const regex = /!`([^`]+)`/g;
  const results: DynamicContextIR[] = [];
  let match;
  while ((match = regex.exec(body)) !== null) {
    results.push({ placeholder: match[0], command: match[1] });
  }
  return results;
}

function parseStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function collectFiles(dir: string): FileEntry[] {
  if (!fs.existsSync(dir)) return [];
  const files: FileEntry[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      try {
        files.push({ path: entry.name, content: fs.readFileSync(full, 'utf-8') });
      } catch {
        // Skip binary files
      }
    }
  }
  return files;
}
